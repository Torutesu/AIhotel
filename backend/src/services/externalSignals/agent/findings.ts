import { z } from 'zod'

// 外部要因エージェントの結果の形（D-13）。モデルには strict のツール（submit_findings）でこの形を出させ、
// 受け取った後に zod でもう一度確かめる（Web のページに書かれた指示や、壊れた値をそのまま保存しないため）。

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD で指定してください')
const url = z.string().url().max(2000).nullable()
const level = z.enum(['high', 'medium', 'low'])

export const agentEventSchema = z.object({
  name: z.string().min(1).max(200),
  /** concert / sports / conference / festival / exam / nature（桜・紅葉）/ weather（台風・災害）/ other */
  type: z.enum(['concert', 'sports', 'conference', 'festival', 'exam', 'nature', 'weather', 'other']),
  startDate: isoDate,
  endDate: isoDate,
  location: z.string().max(200).nullable(),
  expectedImpact: level,
  /** 規模・根拠（想定来場者数など） */
  description: z.string().max(1000),
  sourceUrl: url,
  /** 過ぎた台風・災害など、需要予測の基準から外すべき期間か */
  excludeFromHistory: z.boolean(),
})

export const agentOpeningSchema = z.object({
  name: z.string().min(1).max(200),
  openingDate: isoDate,
  rooms: z.number().int().min(1).max(10000).nullable(),
  category: z.string().max(100).nullable(),
  location: z.string().max(200).nullable(),
  distanceKm: z.number().min(0).max(100).nullable(),
  expectedImpact: level,
  notes: z.string().max(1000),
  sourceUrl: url,
})

export const agentSignalSchema = z.object({
  kind: z.enum(['inbound', 'access', 'nature', 'climate', 'disaster', 'other']),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
  periodStart: isoDate,
  periodEnd: isoDate,
  direction: z.enum(['up', 'down', 'neutral']),
  magnitude: level,
  sourceUrl: url,
})

export const agentFindingsSchema = z.object({
  events: z.array(agentEventSchema).max(60),
  newHotelOpenings: z.array(agentOpeningSchema).max(20),
  marketSignals: z.array(agentSignalSchema).max(20),
})

export type AgentFindings = z.infer<typeof agentFindingsSchema>
export type AgentEvent = z.infer<typeof agentEventSchema>
export type AgentOpening = z.infer<typeof agentOpeningSchema>
export type AgentSignal = z.infer<typeof agentSignalSchema>

const nullableString = { type: ['string', 'null'] }
const levelSchema = { type: 'string', enum: ['high', 'medium', 'low'] }

/** submit_findings ツールの入力（strict: すべての項目を必須にし、無い値は null） */
export const SUBMIT_FINDINGS_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events', 'newHotelOpenings', 'marketSignals'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'startDate', 'endDate', 'location', 'expectedImpact', 'description', 'sourceUrl', 'excludeFromHistory'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['concert', 'sports', 'conference', 'festival', 'exam', 'nature', 'weather', 'other'] },
          startDate: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: { type: 'string', description: 'YYYY-MM-DD' },
          location: nullableString,
          expectedImpact: levelSchema,
          description: { type: 'string' },
          sourceUrl: nullableString,
          excludeFromHistory: { type: 'boolean' },
        },
      },
    },
    newHotelOpenings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'openingDate', 'rooms', 'category', 'location', 'distanceKm', 'expectedImpact', 'notes', 'sourceUrl'],
        properties: {
          name: { type: 'string' },
          openingDate: { type: 'string', description: 'YYYY-MM-DD（月までしか分からなければその月の1日）' },
          rooms: { type: ['integer', 'null'] },
          category: nullableString,
          location: nullableString,
          distanceKm: { type: ['number', 'null'] },
          expectedImpact: levelSchema,
          notes: { type: 'string' },
          sourceUrl: nullableString,
        },
      },
    },
    marketSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'summary', 'periodStart', 'periodEnd', 'direction', 'magnitude', 'sourceUrl'],
        properties: {
          kind: { type: 'string', enum: ['inbound', 'access', 'nature', 'climate', 'disaster', 'other'] },
          title: { type: 'string' },
          summary: { type: 'string' },
          periodStart: { type: 'string', description: 'YYYY-MM-DD' },
          periodEnd: { type: 'string', description: 'YYYY-MM-DD' },
          direction: { type: 'string', enum: ['up', 'down', 'neutral'] },
          magnitude: levelSchema,
          sourceUrl: nullableString,
        },
      },
    },
  },
} as const

/**
 * モデルの出力を確かめる。形に合わない項目は捨て、残りを返す（1件の誤りで全部を捨てない）。
 * 期間の前後が逆・範囲外の日付も捨てる
 */
export function sanitizeFindings(
  raw: unknown,
  window: { from: string; to: string }
): { findings: AgentFindings; dropped: number } {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  let dropped = 0
  const keep = <T>(items: unknown, schema: z.ZodType<T>, ok: (v: T) => boolean): T[] => {
    if (!Array.isArray(items)) return []
    const result: T[] = []
    for (const item of items) {
      const parsed = schema.safeParse(item)
      if (parsed.success && ok(parsed.data)) result.push(parsed.data)
      else dropped++
    }
    return result
  }
  const inWindow = (start: string, end: string) => start <= end && end >= window.from && start <= window.to
  const findings: AgentFindings = {
    events: keep(input.events, agentEventSchema, (e) => inWindow(e.startDate, e.endDate)).slice(0, 60),
    newHotelOpenings: keep(input.newHotelOpenings, agentOpeningSchema, () => true).slice(0, 20),
    marketSignals: keep(input.marketSignals, agentSignalSchema, (s) => inWindow(s.periodStart, s.periodEnd)).slice(0, 20),
  }
  return { findings, dropped }
}
