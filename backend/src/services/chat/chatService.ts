// 会話フィードバック（docs/外部要因設計.md §7）。
//   ユーザーの発話 → LLM（ツール呼び出し）→ 数字はツールから、根拠は知識ベースから → 回答＋実行した操作を保存
import type { UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { ForbiddenError, NotFoundError } from '../../middlewares/errorHandler.js'
import { getLlmProviderForHotel } from '../llm/llmService.js'
import type { ChatTurnMessage, LlmProviderName, ToolCallRecord } from '../llm/types.js'
import { findTool, toolsForRole, type ToolContext } from './chatTools.js'
import { getPricingDigestService } from '../pricing/digestService.js'
import { toIsoDate } from '../signals/holidaySignal.js'

const HISTORY_LIMIT = 20
const MAX_TURNS = 6
const MAX_OUTPUT_TOKENS = 2000

export interface Citation {
  id: string
  path: string
}

export interface ChatAction {
  tool: string
  input: unknown
  ok: boolean
  summary: string
}

/** search_knowledge の結果から出典を集める（回答本文に現れた章を優先し、無ければ検索結果すべて） */
export function collectCitations(toolCalls: ToolCallRecord[], answer: string): Citation[] {
  const seen = new Map<string, Citation>()
  for (const call of toolCalls) {
    if (call.name !== 'search_knowledge' || !call.ok || !Array.isArray(call.output)) continue
    for (const hit of call.output as Array<{ id: string; path: string }>) {
      if (!seen.has(hit.id)) seen.set(hit.id, { id: hit.id, path: hit.path })
    }
  }
  const all = [...seen.values()]
  const mentioned = all.filter((c) => {
    const heading = c.path.split(' › ')[1]
    return answer.includes(c.path) || (heading != null && heading.length > 0 && answer.includes(heading))
  })
  return mentioned.length > 0 ? mentioned : all
}

export function summarizeAction(call: ToolCallRecord): string {
  const out = (call.output ?? {}) as Record<string, unknown>
  if (!call.ok) return `失敗: ${String(out.error ?? '不明なエラー')}`
  switch (call.name) {
    case 'register_event': {
      const r = (out.registered ?? {}) as Record<string, unknown>
      return `イベント「${r.name}」（${r.startDate}〜${r.endDate}、影響 ${r.expectedImpact}）を登録し ${out.recomputedDays} 日を再計算`
    }
    case 'record_decision':
      return `${out.date} に R${out.appliedRank} を適用（推奨 R${out.recommendedRank}${out.adopted ? '・採用' : '・上書き'}）`
    case 'adjust_factor':
      return `${out.label} の係数を ${Math.round((out.beforePt as number) * 100)}pt → ${Math.round((out.afterPt as number) * 100)}pt に変更し ${out.recomputedDays} 日を再計算`
    case 'ignore_competitor_soldout':
      return `${out.competitorName} の ${out.date} の売止めをシグナルから除外`
    default:
      return call.name
  }
}

export function buildSystemPrompt(params: {
  hotelName: string
  today: string
  totalRooms: number
  weights: { weightOccupancy: number; weightAdr: number; weightCompetitor: number } | null
  role: UserRole
  digestLine: string
}): string {
  return [
    `あなたは「${params.hotelName}」のレベニューマネジメント担当を支援するアシスタントです。今日は ${params.today}、客室数は ${params.totalRooms} 室です。`,
    params.weights
      ? `価格戦略の重み: 稼働率 ${params.weights.weightOccupancy}% / ADR ${params.weights.weightAdr}% / 競合追従 ${params.weights.weightCompetitor}%。`
      : '',
    `今日のダイジェスト: ${params.digestLine}`,
    '',
    '守ること:',
    '- 稼働率・ランク・価格・RevPAR などの数字は必ずツールで取得した値を使う。自分で計算・推測しない。',
    '- 考え方や判断基準を説明するときは search_knowledge を呼び、回答の末尾に「出典: ドキュメント名 › 見出し」を書く。資料に無いことは「基礎資料に記載なし」と明言する。',
    '- 設定を変える操作（イベント登録・採否記録・係数調整・売止め除外）は、ユーザーが明確に求めたときだけ実行し、実行後は何がどう変わったか（ランクの前後など）を報告する。曖昧なら実行せず確認する。',
    `- ユーザーの権限は ${params.role} です。権限が無い操作を求められたら、その旨と誰に依頼すべきかを伝える。`,
    '- 日本語で、結論→根拠→次の一手の順に簡潔に。箇条書きは3〜5点まで。',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface SendChatInput {
  hotelId: string
  tenantId: string
  userId: string
  role: UserRole
  conversationId?: string
  content: string
  llmOverride?: { provider?: LlmProviderName; model?: string }
}

export interface ChatReply {
  conversationId: string
  message: {
    id: string
    role: 'assistant'
    content: string
    citations: Citation[]
    actions: ChatAction[]
    llmProvider: string
    llmModel: string
    createdAt: string
  }
  toolsUsed: string[]
}

export async function sendChatMessageService(input: SendChatInput): Promise<ChatReply> {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId }, select: { id: true, name: true, totalRooms: true, tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  let conversation = input.conversationId ? await prisma.chatConversation.findFirst({ where: { id: input.conversationId, hotelId: input.hotelId } }) : null
  if (input.conversationId && !conversation) throw new NotFoundError('会話')
  if (conversation && conversation.userId !== input.userId && input.role !== 'ADMIN') throw new ForbiddenError('他のユーザーの会話にはアクセスできません')
  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: { hotelId: input.hotelId, tenantId: hotel.tenantId, userId: input.userId, title: input.content.slice(0, 60) },
    })
  }

  // LLM の選択（キー未設定なら 400）を先に確認してから DB に書く
  const { provider, selection } = await getLlmProviderForHotel(input.hotelId, input.llmOverride)
  const [history, strategy, digest] = await Promise.all([
    prisma.chatMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT }),
    prisma.pricingStrategyConfig.findUnique({ where: { hotelId: input.hotelId }, select: { weightOccupancy: true, weightAdr: true, weightCompetitor: true } }),
    getPricingDigestService(input.hotelId).catch(() => null),
  ])

  const digestLine = digest
    ? `決めるべき日 ${digest.priorityDays.length}件（上位: ${digest.priorityDays
        .slice(0, 3)
        .map((p) => `${p.date} R${p.comparisonRank}→R${p.recommendedRank} ${p.expectedRevenueDelta >= 0 ? '+' : ''}${p.expectedRevenueDelta.toLocaleString('ja-JP')}円`)
        .join('、')}）、前回からの変化 ${digest.changesSinceYesterday.length}件`
    : '取得できませんでした'

  const messages: ChatTurnMessage[] = [
    ...history.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: input.content },
  ]

  await prisma.chatMessage.create({ data: { conversationId: conversation.id, tenantId: hotel.tenantId, role: 'user', content: input.content } })

  const ctx: ToolContext = { hotelId: input.hotelId, tenantId: hotel.tenantId, userId: input.userId, role: input.role }
  const tools = toolsForRole(input.role)
  const result = await provider.generateWithTools({
    system: buildSystemPrompt({ hotelName: hotel.name, today: toIsoDate(new Date()), totalRooms: hotel.totalRooms, weights: strategy, role: input.role, digestLine }),
    messages,
    tools,
    execute: (name, toolInput) => findTool(name, input.role).run(toolInput, ctx),
    maxTurns: MAX_TURNS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  const citations = collectCitations(result.toolCalls, result.text)
  const actions: ChatAction[] = result.toolCalls
    .filter((c) => tools.find((t) => t.name === c.name)?.write)
    .map((c) => ({ tool: c.name, input: c.input, ok: c.ok, summary: summarizeAction(c) }))
  const content = result.text || (actions.length > 0 ? actions.map((a) => a.summary).join('\n') : '（応答が空でした）')

  const saved = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      tenantId: hotel.tenantId,
      role: 'assistant',
      content,
      citations: citations as unknown as object,
      actions: actions as unknown as object,
      llmProvider: selection.provider,
      llmModel: selection.model,
    },
  })
  await prisma.chatConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })

  return {
    conversationId: conversation.id,
    message: {
      id: saved.id,
      role: 'assistant',
      content,
      citations,
      actions,
      llmProvider: selection.provider,
      llmModel: selection.model,
      createdAt: saved.createdAt.toISOString(),
    },
    toolsUsed: [...new Set(result.toolCalls.map((c) => c.name))],
  }
}

export async function listConversationsService(hotelId: string, userId: string, role: UserRole) {
  return prisma.chatConversation.findMany({
    where: { hotelId, ...(role === 'ADMIN' ? {} : { userId }) },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    select: { id: true, title: true, userId: true, createdAt: true, updatedAt: true },
  })
}

export async function getConversationService(id: string, hotelId: string, userId: string, role: UserRole) {
  const conv = await prisma.chatConversation.findFirst({ where: { id, hotelId }, include: { messages: { orderBy: { createdAt: 'asc' } } } })
  if (!conv) throw new NotFoundError('会話')
  if (conv.userId !== userId && role !== 'ADMIN') throw new ForbiddenError('他のユーザーの会話にはアクセスできません')
  return conv
}

/** チャットが使えるツール一覧（UI の説明用） */
export function describeChatTools(role: UserRole) {
  return toolsForRole(role).map((t) => ({ name: t.name, description: t.description.split('。')[0], write: t.write }))
}
