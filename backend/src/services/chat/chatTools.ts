// 会話フィードバック用のツール群（docs/外部要因設計.md §7）。
// LLM はここに列挙したツールだけを呼べる。読み取り系は全ロール、書き込み系はロールで制限し、
// 実行結果は ChatMessage.actions と監査ログに残す。数字はモデルに計算させず、必ずツールの値を使わせる。
import { z } from 'zod/v4'
import type { UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../middlewares/errorHandler.js'
import { writeAuditLog } from '../auditService.js'
import type { ToolDefinition } from '../llm/types.js'
import { searchAllKnowledge } from '../knowledge/tenantKnowledgeService.js'
import { getPricingDigestService, summarizeFactors } from '../pricing/digestService.js'
import { recordDecisionService } from '../pricing/decisionService.js'
import { createEventService } from '../eventsService.js'
import { recomputeForecastService, type RecommendationExplanation } from '../forecast/forecastService.js'
import { getFactorEvaluationService } from '../forecast/evaluationService.js'
import { setCompetitorSoldOutIgnoredService } from '../integrations/competitorImportService.js'
import { FACTOR_DEFAULTS, factorLabel } from '../forecast/factorDefaults.js'
import { getAppliedRanksService } from '../pricing/marketContext.js'
import { toIsoDate } from '../signals/holidaySignal.js'

export interface ToolContext {
  hotelId: string
  tenantId: string
  userId: string
  role: UserRole
}

export interface ChatTool extends ToolDefinition {
  /** 実行できるロール。未指定なら全ロール */
  roles?: UserRole[]
  /** 書き込み（設定変更）ツールか。actions として記録する */
  write: boolean
  run: (input: unknown, ctx: ToolContext) => Promise<unknown>
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`)
const MANAGER_UP: UserRole[] = ['ADMIN', 'MANAGER']
export const ADJUSTABLE_FACTOR_KEYS = Object.keys(FACTOR_DEFAULTS).filter(
  (k) => !k.startsWith('calib:') && !k.startsWith('pace:alpha') && !k.startsWith('strategy:') && k !== 'price:sigma'
)

function addUtcDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

async function audit(ctx: ToolContext, entity: string, entityId: string | null, value: Record<string, unknown>) {
  await writeAuditLog({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'UPDATE', entity, entityId, newValue: { viaChat: true, ...value } })
}

const overviewInput = z.object({ startDate: isoDate, endDate: isoDate })
const explainInput = z.object({ date: isoDate })
const scorecardInput = z.object({ lookbackDays: z.number().int().min(14).max(365).optional() })
const knowledgeInput = z.object({ query: z.string().min(1).max(200) })
const registerEventInput = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['concert', 'sports', 'conference', 'festival', 'exhibition', 'construction', 'group', 'other']),
  startDate: isoDate,
  endDate: isoDate,
  expectedImpact: z.enum(['high', 'medium', 'low', 'negative']),
  description: z.string().max(500).optional(),
})
const decisionInput = z.object({ date: isoDate, appliedRank: z.number().int().min(1).max(40), reason: z.string().max(300).optional() })
const adjustFactorInput = z.object({ factorKey: z.string().min(1).max(60), deltaPt: z.number().min(-0.2).max(0.2), reason: z.string().min(1).max(300) })
const ignoreSoldOutInput = z.object({ competitorName: z.string().min(1).max(100), date: isoDate, reason: z.string().max(300).optional() })

export const CHAT_TOOLS: ChatTool[] = [
  {
    name: 'get_pricing_overview',
    description:
      '期間内の日別のAI推奨（需要レベル・予測稼働率・推奨ランクと価格・適用中ランク・期待RevPAR・主な要因）を返す。価格や需要の質問にはまずこれを呼ぶ。最大62日',
    inputSchema: overviewInput,
    write: false,
    async run(raw, ctx) {
      const input = overviewInput.parse(raw)
      const start = toDate(input.startDate)
      const end = toDate(input.endDate)
      if ((end.getTime() - start.getTime()) / 86_400_000 > 62) throw new BadRequestError('期間は62日以内で指定してください')
      const [recs, applied] = await Promise.all([
        prisma.aiPriceRecommendation.findMany({ where: { hotelId: ctx.hotelId, roomTypeId: null, date: { gte: start, lte: end } }, orderBy: { date: 'asc' } }),
        getAppliedRanksService(ctx.hotelId, start, end),
      ])
      return recs.map((r) => {
        const ex = r.contributions as unknown as RecommendationExplanation | null
        const key = toIsoDate(r.date)
        return {
          date: key,
          demandLevel: r.demandLevel,
          predictedOccupancy: r.predictedOccupancy,
          recommendedRank: r.recommendedRank,
          recommendedPrice: r.recommendedPrice,
          currentRank: applied.get(key) ?? null,
          expectedRevParCurrent: r.expectedRevParCurrent,
          expectedRevParRecommended: r.expectedRevParRecommended,
          mainFactors: ex ? summarizeFactors(ex.demandFactors).summary : null,
        }
      })
    },
  },
  {
    name: 'explain_recommendation',
    description: '指定日の推奨ランクの理由分解（需要要因のpt内訳、ランク寄与、候補、期待RevPAR、信頼区間）を返す。「なぜこのランクか」に答えるときに使う',
    inputSchema: explainInput,
    write: false,
    async run(raw, ctx) {
      const input = explainInput.parse(raw)
      const rec = await prisma.aiPriceRecommendation.findFirst({ where: { hotelId: ctx.hotelId, roomTypeId: null, date: toDate(input.date) } })
      if (!rec) throw new NotFoundError('この日のAI推奨')
      return {
        date: input.date,
        demandLevel: rec.demandLevel,
        predictedOccupancy: rec.predictedOccupancy,
        recommendedRank: rec.recommendedRank,
        recommendedPrice: rec.recommendedPrice,
        expectedRevParCurrent: rec.expectedRevParCurrent,
        expectedRevParRecommended: rec.expectedRevParRecommended,
        explanation: rec.contributions as unknown as RecommendationExplanation | null,
      }
    },
  },
  {
    name: 'get_daily_digest',
    description: '今日決めるべき日（期待増収額順）、前回からの変化理由、昨日の答え合わせ、採用率を返す。「今日何をすべきか」「昨日どうだったか」に使う',
    inputSchema: z.object({}),
    write: false,
    async run(_raw, ctx) {
      const d = await getPricingDigestService(ctx.hotelId)
      return { ...d, priorityDays: d.priorityDays.map(({ topFactors: _t, ...rest }) => rest) }
    },
  },
  {
    name: 'get_factor_scorecard',
    description: '外部要因・内部要因の評価（要因を外したときの精度変化＝アブレーション、要因別の残差の傾向＝過小/過大評価）を返す。「この要因は効いているか」に使う',
    inputSchema: scorecardInput,
    write: false,
    async run(raw, ctx) {
      const input = scorecardInput.parse(raw)
      return getFactorEvaluationService(ctx.hotelId, input.lookbackDays)
    },
  },
  {
    name: 'search_knowledge',
    description:
      '基礎資料（【汎用】レベニューマネジメントの基礎）と個社MD（【個社】このホテルの方針・制約）から関連する章を検索する。考え方・判断基準・用語の説明を求められたら必ず呼び、回答では章の label を出典として明記する。個社と汎用が食い違うときは個社を優先し、両方を示す。資料に無いことは「資料に記載なし」と答える',
    inputSchema: knowledgeInput,
    write: false,
    async run(raw, ctx) {
      const input = knowledgeInput.parse(raw)
      const hits = await searchAllKnowledge({ tenantId: ctx.tenantId, hotelId: ctx.hotelId }, input.query, 5)
      return hits.map((h) => ({ id: h.chunk.id, path: h.chunk.path, label: h.label, scope: h.scope, text: h.chunk.text }))
    },
  },
  {
    name: 'register_event',
    description:
      'イベントや外部要因（工事・団体・近隣催事など）を登録し、該当期間の需要予測を再計算する。需要を下げる要因（工事・交通障害・団体キャンセルなど）は expectedImpact を negative にする。ユーザーが登録を明確に求めたときだけ使う',
    inputSchema: registerEventInput,
    write: true,
    async run(raw, ctx) {
      const input = registerEventInput.parse(raw)
      const start = toDate(input.startDate)
      const end = toDate(input.endDate)
      if (start > end) throw new BadRequestError('開始日は終了日以前である必要があります')
      const event = await createEventService(
        { hotelId: ctx.hotelId, name: input.name, type: input.type, startDate: start, endDate: end, expectedImpact: input.expectedImpact, description: input.description },
        ctx.userId
      )
      await audit(ctx, 'Event', event.id, { name: input.name, startDate: input.startDate, endDate: input.endDate, expectedImpact: input.expectedImpact })
      const f = await recomputeForecastService(ctx.hotelId, start, addUtcDays(end, 1))
      return { eventId: event.id, registered: input, recomputedDays: f.count }
    },
  },
  {
    name: 'record_decision',
    description:
      '指定日に適用するランクを採否記録として保存する（推奨どおりなら採用、違うランクなら理由付きの上書き）。ユーザーが「採用して」「R20にして」などと明確に指示したときだけ使う',
    inputSchema: decisionInput,
    roles: MANAGER_UP,
    write: true,
    async run(raw, ctx) {
      const input = decisionInput.parse(raw)
      const d = await recordDecisionService({ hotelId: ctx.hotelId, date: toDate(input.date), appliedRank: input.appliedRank, reason: input.reason }, ctx.userId)
      await audit(ctx, 'RecommendationDecision', d.id, { date: input.date, recommendedRank: d.recommendedRank, appliedRank: d.appliedRank, reason: input.reason })
      return { decisionId: d.id, date: input.date, recommendedRank: d.recommendedRank, appliedRank: d.appliedRank, adopted: d.recommendedRank === d.appliedRank }
    },
  },
  {
    name: 'adjust_factor',
    description: `要因の係数（稼働率pt）を人の判断で調整し、今後90日を再計算する。例: 連休前夜をもっと強気にしたいなら factorKey=holiday:eve, deltaPt=0.03。使えるキー: ${ADJUSTABLE_FACTOR_KEYS.join(', ')}。ユーザーが係数の変更を明確に求めたときだけ使う`,
    inputSchema: adjustFactorInput,
    roles: MANAGER_UP,
    write: true,
    async run(raw, ctx) {
      const input = adjustFactorInput.parse(raw)
      if (!ADJUSTABLE_FACTOR_KEYS.includes(input.factorKey)) throw new BadRequestError(`不明な要因キーです: ${input.factorKey}`)
      const existing = await prisma.factorCoefficient.findUnique({ where: { hotelId_factorKey: { hotelId: ctx.hotelId, factorKey: input.factorKey } } })
      const before = existing?.value ?? FACTOR_DEFAULTS[input.factorKey]
      const after = Math.max(-0.3, Math.min(0.3, before + input.deltaPt))
      await prisma.factorCoefficient.upsert({
        where: { hotelId_factorKey: { hotelId: ctx.hotelId, factorKey: input.factorKey } },
        update: { value: after },
        create: { hotelId: ctx.hotelId, tenantId: ctx.tenantId, factorKey: input.factorKey, value: after, sampleSize: existing?.sampleSize ?? 0 },
      })
      await audit(ctx, 'FactorCoefficient', input.factorKey, { before, after, reason: input.reason })
      const f = await recomputeForecastService(ctx.hotelId)
      return { factorKey: input.factorKey, label: factorLabel(input.factorKey), beforePt: before, afterPt: after, recomputedDays: f.count }
    },
  },
  {
    name: 'ignore_competitor_soldout',
    description:
      '競合の特定日の売止めを「実需ではない（団体・改装など）」として逼迫シグナルから除外し、再計算する。ユーザーがそう判断したときだけ使う。競合名は部分一致でよい',
    inputSchema: ignoreSoldOutInput,
    roles: MANAGER_UP,
    write: true,
    async run(raw, ctx) {
      const input = ignoreSoldOutInput.parse(raw)
      const comp = await prisma.competitor.findFirst({ where: { hotelId: ctx.hotelId, isActive: true, name: { contains: input.competitorName } }, select: { id: true, name: true } })
      if (!comp) throw new NotFoundError(`競合ホテル「${input.competitorName}」`)
      const r = await setCompetitorSoldOutIgnoredService(ctx.hotelId, comp.id, toDate(input.date), true, input.reason)
      await audit(ctx, 'CompetitorPriceData', comp.id, { competitorName: comp.name, date: input.date, reason: input.reason })
      const f = await recomputeForecastService(ctx.hotelId, toDate(input.date), addUtcDays(toDate(input.date), 1))
      return { ...r, recomputedDays: f.count }
    },
  },
]

export function toolsForRole(role: UserRole): ChatTool[] {
  return CHAT_TOOLS.filter((t) => !t.roles || t.roles.includes(role))
}

export function findTool(name: string, role: UserRole): ChatTool {
  const tool = CHAT_TOOLS.find((t) => t.name === name)
  if (!tool) throw new BadRequestError(`不明なツールです: ${name}`)
  if (tool.roles && !tool.roles.includes(role)) throw new ForbiddenError('この操作を行う権限がありません')
  return tool
}
