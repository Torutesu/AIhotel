import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { config } from '../../lib/config.js'
import { prisma } from '../../lib/prisma.js'
import { monthRange } from '../../lib/date.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { MessagesClient } from '../externalSignals/agent/collect.js'
import { getChannelBreakdownService, getRoomTypeBreakdownService } from '../analysisService.js'
import { getBookingWindowsService, getGuestCountsService } from '../reservationAnalysis.js'

// 分析タブのインサイトの文章（D-13）。日次バッチがホテルごとに1日1回、当月について作る。
// generate.ts（ダッシュボード・価格・外部需要）とは別の呼び出しにして、片方の失敗がもう片方を止めないようにする。
// 材料は分析タブに出している集計そのもの（チャネル別・部屋タイプ別・利用人数別・リードタイム別・日のタイプ別）だけで、
// 文章の中の数字はここに入れた値からしか使わせない。保存先は AiComment（section = analysis-insights、content は JSON）:
//   segments:    分析インサイト（部屋タイプ・利用人数・チャネル・日のタイプの切り口ごとに1つ）
//   composition: 需要構成インサイト（チャネル・部屋タイプ・利用人数をまたいだコメント）
//   leadTime:    リードタイム分析インサイト

export const ANALYSIS_INSIGHTS_SECTION = 'analysis-insights'
export const INSIGHT_SEGMENTS = ['部屋タイプ', '利用人数', 'チャネル', '日のタイプ'] as const

const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 10)

export interface AnalysisFacts {
  hotelName: string
  month: string
  /** 当月の何日目までが実績か（それより後は予約済みの分だけ） */
  today: string
  channels: Array<{ channel: string; roomsSold: number; revenue: number; adr: number | null; revenueSharePct: number; revenueYoyPct: number | null }>
  roomTypes: Array<{ name: string; rooms: number; soldRooms: number; adr: number | null; occupancyPct: number | null; revenueSharePct: number; revenueYoyPct: number | null }>
  guestCounts: Array<{ segment: string; soldRooms: number; adr: number | null; guestUnitPrice: number | null; roomsSharePct: number | null; revenueYoyPct: number | null }>
  leadTimes: Array<{ window: string; soldRooms: number; adr: number | null; revenueSharePct: number | null; cancelRatePct: number | null; yoyPct: number | null }>
  dayTypes: Array<{ dayType: string; days: number; actualDays: number; avgOccupancyPct: number | null; avgAdr: number | null; avgPredictedOccupancyPct: number | null }>
}

export async function buildAnalysisFacts(hotelId: string, year: number, month: number, today: Date): Promise<AnalysisFacts> {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { name: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { start, end } = monthRange(year, month)
  const [channels, roomTypes, guestCounts, windows, recs, actuals] = await Promise.all([
    getChannelBreakdownService(hotelId, year, month),
    getRoomTypeBreakdownService(hotelId, year, month),
    getGuestCountsService(hotelId, year, month),
    getBookingWindowsService(hotelId, year, month),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: start, lt: end } },
      select: { date: true, predictedOccupancy: true, rationale: true },
    }),
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lt: end } }, select: { date: true, occupancy: true, adr: true } }),
  ])

  // 日のタイプ（v6 の型の名前）ごとに、実績のある日の平均と予測の平均
  const actualByDay = new Map(actuals.map((a) => [a.date.getTime(), a]))
  const byType = new Map<string, { days: number; occ: number[]; adr: number[]; predicted: number[] }>()
  for (const rec of recs) {
    const name = (rec.rationale as { dayType?: { name?: string | null } } | null)?.dayType?.name
    if (!name) continue
    const acc = byType.get(name) ?? { days: 0, occ: [], adr: [], predicted: [] }
    acc.days++
    if (rec.predictedOccupancy != null) acc.predicted.push(rec.predictedOccupancy)
    const actual = actualByDay.get(rec.date.getTime())
    if (actual?.occupancy != null) acc.occ.push(actual.occupancy)
    if (actual?.adr != null) acc.adr.push(actual.adr)
    byType.set(name, acc)
  }
  const avg = (list: number[]) => (list.length === 0 ? null : list.reduce((a, b) => a + b, 0) / list.length)

  return {
    hotelName: hotel.name,
    month: `${year}年${month}月`,
    today: today.toISOString().slice(0, 10),
    channels: channels.channels.slice(0, 10).map((c) => ({
      channel: c.channel,
      roomsSold: c.roomsSold,
      revenue: c.revenue,
      adr: c.adr,
      revenueSharePct: c.revenueShare,
      revenueYoyPct: c.revenueYoy,
    })),
    roomTypes: roomTypes.roomTypes
      .filter((t) => t.soldRooms > 0)
      .map((t) => ({
        name: t.name,
        rooms: t.count,
        soldRooms: t.soldRooms,
        adr: t.adr,
        occupancyPct: pct(t.occupancy),
        revenueSharePct: t.revenueShare,
        revenueYoyPct: t.revenueYoy,
      })),
    guestCounts: guestCounts.segments
      .filter((s) => s.soldRooms > 0)
      .map((s) => ({ segment: s.name, soldRooms: s.soldRooms, adr: s.adr, guestUnitPrice: s.guestUnitPrice, roomsSharePct: s.roomsShare, revenueYoyPct: s.yoy })),
    leadTimes: windows.bookings
      .filter((w) => w.soldRooms > 0)
      .map((w) => ({ window: w.window, soldRooms: w.soldRooms, adr: w.adr, revenueSharePct: w.revenueShare, cancelRatePct: w.cancelRate, yoyPct: w.yoy })),
    dayTypes: [...byType.entries()].map(([dayType, v]) => ({
      dayType,
      days: v.days,
      actualDays: v.occ.length,
      avgOccupancyPct: pct(avg(v.occ)),
      avgAdr: v.adr.length === 0 ? null : Math.round(avg(v.adr)!),
      avgPredictedOccupancyPct: pct(avg(v.predicted)),
    })),
  }
}

/** 材料が1つも無ければ呼び出さない（費用をかけて「データがありません」を書かせない） */
export function hasAnalysisFacts(facts: AnalysisFacts): boolean {
  return facts.channels.length + facts.roomTypes.length + facts.guestCounts.length + facts.leadTimes.length + facts.dayTypes.length > 0
}

const SYSTEM = `あなたはホテルのレベニューマネージャーを手伝うアナリストです。渡された当月の分析の集計（JSON）だけをもとに、日本語で短いインサイトを書き、submit_insights ツールで1回だけ提出します。
守ること:
- 数字・名前は、渡された事実にあるものだけを使う。計算して新しい数字を作らない
- 事実に無いこと（天気・競合・ニュースなど）を推測で書かない。月全体の進捗や個別の日の対応は書かない（ほかの画面が担当する）
- segments は切り口（部屋タイプ・利用人数・チャネル・日のタイプ）ごとに最大1件。その切り口の集計が空なら出さない
- composition はチャネル・部屋タイプ・利用人数をまたいだ需要構成全体へのコメント。leadTime は予約が入った時期（リードタイム）のコメント。材料が無ければ空の配列
- 敬体（です・ます）で、1件は2文まで。料金ランクの具体的な数字は勧めない
- revenueYoyPct・yoyPct は前年同月からの増減率（%。0 が前年と同じ、+10 は1割増）、cancelRatePct はキャンセル率（%）`

const SUBMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segments', 'composition', 'leadTime'],
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['segment', 'text'],
        properties: { segment: { type: 'string', enum: [...INSIGHT_SEGMENTS] }, text: { type: 'string', description: '120字以内' } },
      },
    },
    composition: { type: 'array', description: '最大3件。1件120字以内', items: { type: 'string' } },
    leadTime: { type: 'array', description: '最大3件。1件120字以内', items: { type: 'string' } },
  },
} as const

const text = z.string().min(1).max(300)
const resultSchema = z.object({
  segments: z.array(z.object({ segment: z.enum(INSIGHT_SEGMENTS), text })).max(8),
  composition: z.array(text).max(6),
  leadTime: z.array(text).max(6),
})
export type AnalysisInsights = z.infer<typeof resultSchema>

export async function generateAnalysisInsights(client: MessagesClient, facts: AnalysisFacts, model = config.EXTERNAL_AGENT_MODEL): Promise<AnalysisInsights & { model: string }> {
  const response = await client.create({
    model,
    max_tokens: 3000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: SYSTEM,
    tools: [
      {
        name: 'submit_insights',
        description: '分析タブのインサイト（切り口別・需要構成・リードタイム）を提出する',
        strict: true,
        input_schema: SUBMIT_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
      },
    ],
    messages: [{ role: 'user', content: `次の当月の分析の集計をもとに、submit_insights で提出してください。\n\n<facts>\n${JSON.stringify(facts)}\n</facts>` }],
  })
  if (response.stop_reason === 'refusal') throw new Error('分析インサイトの生成を断られました')
  const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'submit_insights')
  if (!call) throw new Error('分析インサイトの生成で提出がありませんでした')
  const parsed = resultSchema.safeParse(call.input)
  if (!parsed.success) throw new Error(`分析インサイトの形が想定と違います: ${parsed.error.issues[0]?.message ?? ''}`)
  // 切り口ごとに1件まで（重複は先のものを残す）
  const seen = new Set<string>()
  const segments = parsed.data.segments.filter((s) => !seen.has(s.segment) && seen.add(s.segment))
  return { segments, composition: parsed.data.composition.slice(0, 3), leadTime: parsed.data.leadTime.slice(0, 3), model: response.model }
}

/** 当月の分析インサイトを作って保存する。材料が無ければ何もしない（false を返す） */
export async function generateAnalysisInsightsForHotel(client: MessagesClient, hotelId: string, today: Date, now: Date = new Date()): Promise<boolean> {
  const hotel = await prisma.hotel.findFirstOrThrow({ where: { id: hotelId }, select: { tenantId: true } })
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1
  const facts = await buildAnalysisFacts(hotelId, year, month, today)
  if (!hasAnalysisFacts(facts)) return false
  const generated = await generateAnalysisInsights(client, facts)
  const { model, ...insights } = generated
  await prisma.aiComment.create({
    data: {
      tenantId: hotel.tenantId,
      hotelId,
      section: ANALYSIS_INSIGHTS_SECTION,
      content: JSON.stringify({ year, month, ...insights }),
      modelVersion: model,
      generatedAt: now,
    },
  })
  return true
}
