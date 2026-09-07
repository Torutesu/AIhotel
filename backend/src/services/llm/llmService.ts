// LLM の選択と生成（純粋な選択ロジック resolveLlmSelection はテスト可能）。
//   優先順位: リクエストの明示指定 > ホテル設定（Hotel.llmProvider/llmModel） > 環境変数の既定
// API キーが無いプロバイダは選べない（400）。サイレントに別プロバイダへ倒さない
import { prisma } from '../../lib/prisma.js'
import { config } from '../../lib/config.js'
import { BadRequestError } from '../../middlewares/errorHandler.js'
import { createAnthropicProvider } from './anthropicProvider.js'
import { createOpenAiProvider } from './openaiProvider.js'
import { KNOWN_MODELS, PROVIDER_LABELS, type LlmProvider, type LlmProviderName } from './types.js'

export interface LlmSelection {
  provider: LlmProviderName
  model: string
  /** 選択の出どころ（UI 表示用） */
  source: 'request' | 'hotel' | 'env'
}

export interface LlmEnv {
  defaultProvider: LlmProviderName
  anthropicKey: string | undefined
  anthropicModel: string
  openaiKey: string | undefined
  openaiModel: string
}

export function envFromConfig(): LlmEnv {
  return {
    defaultProvider: config.LLM_PROVIDER,
    anthropicKey: config.ANTHROPIC_API_KEY,
    anthropicModel: config.ANTHROPIC_MODEL,
    openaiKey: config.OPENAI_API_KEY,
    openaiModel: config.OPENAI_MODEL,
  }
}

function isProviderName(v: unknown): v is LlmProviderName {
  return v === 'anthropic' || v === 'openai'
}

/**
 * どのプロバイダ・モデルを使うか決める（DB・ネットワーク非依存）
 */
export function resolveLlmSelection(
  env: LlmEnv,
  hotel: { llmProvider: string | null; llmModel: string | null } | null,
  override?: { provider?: LlmProviderName; model?: string }
): LlmSelection {
  let provider: LlmProviderName
  let source: LlmSelection['source']
  if (override?.provider) {
    provider = override.provider
    source = 'request'
  } else if (hotel && isProviderName(hotel.llmProvider)) {
    provider = hotel.llmProvider
    source = 'hotel'
  } else {
    provider = env.defaultProvider
    source = 'env'
  }

  const envModel = provider === 'anthropic' ? env.anthropicModel : env.openaiModel
  // モデルは「指定プロバイダに対する明示指定」だけを尊重する（別プロバイダのモデル名を引き継がない）
  let model: string
  if (override?.model) model = override.model
  else if (hotel?.llmModel && (override?.provider == null || override.provider === hotel.llmProvider) && hotel.llmProvider === provider) model = hotel.llmModel
  else model = envModel

  const key = provider === 'anthropic' ? env.anthropicKey : env.openaiKey
  if (!key) {
    throw new BadRequestError(
      `${PROVIDER_LABELS[provider]} を使うには ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} の設定が必要です`
    )
  }
  return { provider, model, source }
}

export function createProvider(selection: LlmSelection): LlmProvider {
  if (selection.provider === 'anthropic') return createAnthropicProvider(config.ANTHROPIC_API_KEY!, selection.model)
  return createOpenAiProvider(config.OPENAI_API_KEY!, selection.model, config.OPENAI_BASE_URL)
}

/**
 * ホテルの設定と任意の上書きから LLM プロバイダを作る
 */
export async function getLlmProviderForHotel(
  hotelId: string,
  override?: { provider?: LlmProviderName; model?: string }
): Promise<{ provider: LlmProvider; selection: LlmSelection }> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { llmProvider: true, llmModel: true } })
  const selection = resolveLlmSelection(envFromConfig(), hotel, override)
  return { provider: createProvider(selection), selection }
}

export interface LlmOptions {
  defaultProvider: LlmProviderName
  providers: Array<{
    id: LlmProviderName
    label: string
    configured: boolean
    defaultModel: string
    knownModels: Array<{ id: string; label: string }>
  }>
  /** このホテルで実際に使われる選択（設定が無ければ環境の既定） */
  effective: LlmSelection | null
  effectiveError: string | null
}

/**
 * 設定画面用: 利用可能なプロバイダ・既知モデル・現在の実効選択
 */
export async function getLlmOptionsService(hotelId: string): Promise<LlmOptions> {
  const env = envFromConfig()
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { llmProvider: true, llmModel: true } })
  let effective: LlmSelection | null = null
  let effectiveError: string | null = null
  try {
    effective = resolveLlmSelection(env, hotel)
  } catch (err) {
    effectiveError = err instanceof Error ? err.message : String(err)
  }
  return {
    defaultProvider: env.defaultProvider,
    providers: (['anthropic', 'openai'] as const).map((id) => ({
      id,
      label: PROVIDER_LABELS[id],
      configured: id === 'anthropic' ? !!env.anthropicKey : !!env.openaiKey,
      defaultModel: id === 'anthropic' ? env.anthropicModel : env.openaiModel,
      knownModels: KNOWN_MODELS[id],
    })),
    effective,
    effectiveError,
  }
}
