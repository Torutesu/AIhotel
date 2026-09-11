// AIまとめの生成（Phase 4: LLM 連携。services/llm/ で Claude / GPT を切替）。
// ダイジェスト・要因評価・知識ベースを材料に、構造化出力で「今日の要点・注目日・次の一手」を作り AiComment に保存する
import { z } from 'zod/v4'
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { getLlmProviderForHotel } from '../llm/llmService.js'
import type { LlmProviderName } from '../llm/types.js'
import { getPricingDigestService } from '../pricing/digestService.js'
import { getFactorEvaluationService } from '../forecast/evaluationService.js'
import { searchAllKnowledge, getTenantKnowledgeContextService } from '../knowledge/tenantKnowledgeService.js'

const SummarySchema = z.object({
  headline: z.string().describe('1文の結論（今日いちばん大事なこと）'),
  highlights: z.array(z.string()).max(5).describe('注目日や変化の要点。数字は入力の値をそのまま使う'),
  actions: z.array(z.string()).max(4).describe('次の一手。具体的な日付とランク'),
  caveats: z.array(z.string()).max(3).describe('注意点（データ不足、予測の幅が広い日など）'),
  citations: z.array(z.string()).describe('根拠にした基礎資料の path（ドキュメント名 › 見出し）'),
})

export type AiSummaryPayload = z.infer<typeof SummarySchema>

export function renderSummary(p: AiSummaryPayload): string {
  const lines = [p.headline, '']
  if (p.highlights.length) lines.push('【注目】', ...p.highlights.map((h) => `・${h}`), '')
  if (p.actions.length) lines.push('【次の一手】', ...p.actions.map((a) => `・${a}`), '')
  if (p.caveats.length) lines.push('【注意】', ...p.caveats.map((c) => `・${c}`), '')
  if (p.citations.length) lines.push(`出典: ${p.citations.join(' / ')}`)
  return lines.join('\n').trim()
}

export async function generateAiSummaryService(
  hotelId: string,
  section = 'dashboard-summary',
  llmOverride?: { provider?: LlmProviderName; model?: string }
) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true, name: true, tenantId: true, totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { provider, selection } = await getLlmProviderForHotel(hotelId, llmOverride)
  const [digest, evaluation] = await Promise.all([getPricingDigestService(hotelId), getFactorEvaluationService(hotelId, 90).catch(() => null)])
  const [hits, tenantKnowledge] = await Promise.all([
    searchAllKnowledge({ tenantId: hotel.tenantId, hotelId }, '日次運用 判断 需要レベル 採用 方針', 4),
    getTenantKnowledgeContextService(hotel.tenantId, hotelId),
  ])
  const knowledge = hits.map((h) => ({ path: h.label, text: h.chunk.text }))

  const input = {
    hotel: { name: hotel.name, totalRooms: hotel.totalRooms },
    hotelRules: tenantKnowledge.rulesSummary || null,
    asOfDate: digest.asOfDate,
    priorityDays: digest.priorityDays.slice(0, 6).map(({ topFactors: _t, ...rest }) => rest),
    changesSinceYesterday: digest.changesSinceYesterday.slice(0, 6),
    yesterdayReview: digest.yesterdayReview,
    adoption: digest.adoption,
    factorEvaluation: evaluation
      ? { samples: evaluation.samples, ablation: evaluation.ablation.filter((a) => a.activeDays > 0), scorecard: evaluation.scorecard.slice(0, 6) }
      : null,
    knowledge,
  }

  const res = await provider.generateStructured({
    system:
      'あなたはホテルのレベニューマネジメント担当向けに毎朝の要約を書くアシスタントです。入力の数字だけを使い、推測で数字を作らないでください。hotelRules（個社ルール）があれば最優先で従い、考え方の根拠は knowledge の章を引用して citations にその path（【個社】/【汎用】付き）を入れてください。日本語で簡潔に。',
    user: `以下のデータから今日のまとめを作ってください。\n${JSON.stringify(input, null, 1)}`,
    schema: SummarySchema,
    schemaName: 'daily_summary',
    maxOutputTokens: 2500,
  })
  const content = renderSummary(res.parsed)
  const comment = await prisma.aiComment.create({
    data: { hotelId, tenantId: hotel.tenantId, section, content, modelVersion: `${selection.provider}/${selection.model}` },
  })
  return { comment, payload: res.parsed, llm: selection }
}
