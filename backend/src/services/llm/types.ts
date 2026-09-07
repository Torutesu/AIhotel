// LLM プロバイダ抽象（docs/外部要因設計.md §3 #3 b）。
// 会場ページ抽出など「テキスト → zod スキーマに沿った構造化 JSON」の用途を、
// Anthropic（Claude）と OpenAI（ChatGPT/GPT）のどちらでも同じ呼び出しで使えるようにする。
import type { z } from 'zod/v4'

export type LlmProviderName = 'anthropic' | 'openai'

export interface StructuredRequest<T extends z.ZodType> {
  /** システムプロンプト */
  system: string
  /** ユーザーメッセージ（抽出対象テキストを含む） */
  user: string
  /** 出力スキーマ（zod v4）。両プロバイダの構造化出力に渡す */
  schema: T
  /** スキーマ名（OpenAI の json_schema に必須。英数字と _ のみ） */
  schemaName: string
  maxOutputTokens: number
}

export interface StructuredResponse<T> {
  parsed: T
  provider: LlmProviderName
  model: string
  usage: { inputTokens: number | null; outputTokens: number | null }
}

export interface LlmProvider {
  readonly name: LlmProviderName
  readonly model: string
  generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResponse<z.infer<T>>>
}

/** UI に返す既知モデルの候補。自由入力も許すため、ここに無いモデルIDも設定可能 */
export const KNOWN_MODELS: Record<LlmProviderName, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: 'claude-opus-5', label: 'Claude Opus 5（高精度）' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5（バランス）' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（高速・低コスト）' },
  ],
  openai: [
    { id: 'gpt-5', label: 'GPT-5（高精度）' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini（バランス）' },
    { id: 'gpt-5-nano', label: 'GPT-5 nano（高速・低コスト）' },
  ],
}

export const PROVIDER_LABELS: Record<LlmProviderName, string> = {
  anthropic: 'Anthropic（Claude）',
  openai: 'OpenAI（ChatGPT / GPT）',
}
