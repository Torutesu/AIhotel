import type Anthropic from '@anthropic-ai/sdk'
import { config } from '../lib/config.js'
import { todayJst } from '../lib/date.js'
import { ApiError } from '../middlewares/errorHandler.js'
import type { ChatInput } from '../lib/validators.js'
import { createAgentClient, type MessagesClient } from './externalSignals/agent/collect.js'
import { buildHotelFacts } from './aiComments/facts.js'
import { buildAnalysisFacts } from './aiComments/analysis.js'

// AI チャット（D-13 — 画面右下のチャット）。ホテルの「事実の束」（AI 解説と分析インサイトの材料と同じもの）だけを材料に、
// 質問に答える。Web 検索やツールは使わない。会話はブラウザが持って毎回送り、サーバーには保存しない。
// 事実の束はシステムプロンプトに入れてキャッシュする（同じ日の続けての質問で読み直しの費用を抑える）。

const SYSTEM = `あなたはホテルのレベニューマネージャーを手伝うアシスタントです。<facts> の事実（JSON）だけをもとに、日本語で短く答えます。
守ること:
- 数字・日付・名前は事実にあるものだけを使う。事実に無いことは「いまのデータには入っていません」と答え、推測で埋めない
- 計算して新しい数字を作らない（事実にある差や割合はそのまま使ってよい）
- 敬体（です・ます）で、要点から。長くても5文程度。必要なら箇条書き
- 価格の変更・設定の操作はできない。勧めるときは画面のどこで行うか（プライシング・設定など）を添える
- ホテルの運営と収益管理に関係のない依頼には、収益管理の相談に使ってほしいと短く伝える`

export interface ChatReply {
  reply: string
  model: string
}

export async function answerChat(client: MessagesClient, input: ChatInput, today: Date = todayJst()): Promise<ChatReply> {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1
  const [hotel, analysis] = await Promise.all([buildHotelFacts(input.hotelId, today), buildAnalysisFacts(input.hotelId, year, month, today)])
  const response = await client.create({
    model: config.EXTERNAL_AGENT_MODEL,
    max_tokens: 1500,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: `<facts>\n${JSON.stringify({ hotel, analysis })}\n</facts>`, cache_control: { type: 'ephemeral' } },
    ],
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
  })
  if (response.stop_reason === 'refusal') return { reply: 'この質問にはお答えできません。収益管理についてのご質問をどうぞ。', model: response.model }
  const reply = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!reply) throw new ApiError(502, 'AI から答えが返りませんでした。もう一度お試しください')
  return { reply, model: response.model }
}

/** ANTHROPIC_API_KEY が無ければ 503（チャットは使えない） */
export async function answerChatService(input: ChatInput): Promise<ChatReply> {
  const client = createAgentClient()
  if (!client) throw new ApiError(503, 'AI チャットは使えません（運営が Claude API のキーを設定すると使えます）')
  return answerChat(client, input)
}
