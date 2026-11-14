import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { config } from '../../lib/config.js'
import { prisma } from '../../lib/prisma.js'
import type { MessagesClient } from '../externalSignals/agent/collect.js'
import { buildHotelFacts, type HotelFacts } from './facts.js'

// AI 解説の文章の生成（D-13 — Claude API による AI コメント）。日次バッチがホテルごとに1日1回呼ぶ。
// 材料は facts.ts の事実の束だけ（Web 検索はしない）。1回の呼び出しで3つを作り、決まった形（strict のツール）で受け取る:
//   dashboard-summary: ダッシュボードの AI 解説（【当月】【先々】）
//   pricing:           プライシングの「AI価格最適化の提案」（優先度つきの提案。content は JSON の配列）
//   external-outlook:  外部需要動向の「AI総合予測コメント」
// 文章の中の数字は事実の束からしか使わせない。受け取った文章は長さを確かめてから保存する。

export const AI_COMMENT_SECTIONS = ['dashboard-summary', 'pricing', 'external-outlook'] as const
/** 古い AI 解説を消すまでの日数 */
export const AI_COMMENT_RETENTION_DAYS = 30

const SYSTEM = `あなたはホテルのレベニューマネージャーを手伝うアナリストです。渡された事実（JSON）だけをもとに、日本語で短い解説と提案を書き、submit_comments ツールで1回だけ提出します。
守ること:
- 数字・日付・名前は、渡された事実にあるものだけを使う。計算して新しい数字を作らない（差や割合も、事実にあるものだけ）
- 事実に無いこと（天気・競合の価格・ニュースなど）を推測で書かない
- 予算の向き合い方: onTrack は予算に届いている、chase は不足しているが追える（稼働寄りにしている）、giveUp は届かない見込みで売上の最大化を優先している
- 日付は「12/5（金）」のように月/日と曜日で書く。敬体（です・ます）で、1文を短く
- 料金ランクの具体的な数字は勧めない（ランクの上げ下げの方向と対象の日を書く）
- 事実が少ないときは、少ないことを正直に書き、無理に提案を増やさない`

const SUBMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dashboardSummary', 'pricingProposals', 'externalOutlook'],
  properties: {
    dashboardSummary: { type: 'string', description: '【当月】と【先々】の2段落。全体で300字以内' },
    pricingProposals: {
      type: 'array',
      description: '価格についての提案。優先度の高い順に最大4件',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'text'],
        properties: {
          level: { type: 'string', enum: ['high', 'medium', 'low'] },
          text: { type: 'string', description: '1件120字以内' },
        },
      },
    },
    externalOutlook: { type: 'string', description: '【総合見通し】【注意事項】【推奨アクション】の3段落。全体で450字以内' },
  },
} as const

const resultSchema = z.object({
  dashboardSummary: z.string().min(1).max(800),
  pricingProposals: z.array(z.object({ level: z.enum(['high', 'medium', 'low']), text: z.string().min(1).max(300) })).max(6),
  externalOutlook: z.string().min(1).max(1200),
})
export type GeneratedComments = z.infer<typeof resultSchema>

export async function generateComments(client: MessagesClient, facts: HotelFacts, model = config.EXTERNAL_AGENT_MODEL): Promise<GeneratedComments & { model: string }> {
  const response = await client.create({
    model,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: SYSTEM,
    tools: [
      {
        name: 'submit_comments',
        description: 'ダッシュボードの解説・価格の提案・外部需要の総合コメントを提出する',
        strict: true,
        input_schema: SUBMIT_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
      },
    ],
    messages: [
      {
        role: 'user',
        content: `次のホテルの事実をもとに、submit_comments で提出してください。\n\n<facts>\n${JSON.stringify(facts)}\n</facts>`,
      },
    ],
  })
  if (response.stop_reason === 'refusal') throw new Error('AI 解説の生成を断られました')
  const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'submit_comments')
  if (!call) throw new Error('AI 解説の生成で提出がありませんでした')
  const parsed = resultSchema.safeParse(call.input)
  if (!parsed.success) throw new Error(`AI 解説の形が想定と違います: ${parsed.error.issues[0]?.message ?? ''}`)
  return { ...parsed.data, pricingProposals: parsed.data.pricingProposals.slice(0, 4), model: response.model }
}

/** 1ホテルの AI 解説を作って保存する（3つのセクション）。古いものは消す */
export async function generateAiCommentsForHotel(client: MessagesClient, hotelId: string, today: Date, now: Date = new Date()): Promise<GeneratedComments> {
  const hotel = await prisma.hotel.findFirstOrThrow({ where: { id: hotelId }, select: { tenantId: true } })
  const facts = await buildHotelFacts(hotelId, today)
  const generated = await generateComments(client, facts)
  const rows = [
    { section: 'dashboard-summary', content: generated.dashboardSummary },
    { section: 'pricing', content: JSON.stringify(generated.pricingProposals) },
    { section: 'external-outlook', content: generated.externalOutlook },
  ]
  await prisma.$transaction([
    prisma.aiComment.createMany({
      data: rows.map((r) => ({ ...r, tenantId: hotel.tenantId, hotelId, modelVersion: generated.model, generatedAt: now })),
    }),
    prisma.aiComment.deleteMany({
      where: { hotelId, generatedAt: { lt: new Date(now.getTime() - AI_COMMENT_RETENTION_DAYS * 86_400_000) } },
    }),
  ])
  return generated
}
