import { describe, it, expect } from 'vitest'
import { resolveLlmSelection, type LlmEnv } from './llmService.js'

const env: LlmEnv = {
  defaultProvider: 'anthropic',
  anthropicKey: 'a-key',
  anthropicModel: 'claude-opus-5',
  openaiKey: 'o-key',
  openaiModel: 'gpt-5',
}

describe('resolveLlmSelection', () => {
  it('何も設定が無ければ環境の既定プロバイダ・モデルを使う', () => {
    expect(resolveLlmSelection(env, null)).toEqual({ provider: 'anthropic', model: 'claude-opus-5', source: 'env' })
  })

  it('ホテル設定があればそれを優先し、モデルも引き継ぐ', () => {
    expect(resolveLlmSelection(env, { llmProvider: 'openai', llmModel: 'gpt-5-mini' })).toEqual({ provider: 'openai', model: 'gpt-5-mini', source: 'hotel' })
  })

  it('ホテル設定のモデルが空なら環境のそのプロバイダ既定モデルを使う', () => {
    expect(resolveLlmSelection(env, { llmProvider: 'openai', llmModel: null })).toEqual({ provider: 'openai', model: 'gpt-5', source: 'hotel' })
  })

  it('リクエストの明示指定はホテル設定より優先し、別プロバイダのモデル名は引き継がない', () => {
    const r = resolveLlmSelection(env, { llmProvider: 'openai', llmModel: 'gpt-5-mini' }, { provider: 'anthropic' })
    expect(r).toEqual({ provider: 'anthropic', model: 'claude-opus-5', source: 'request' })
    const r2 = resolveLlmSelection(env, null, { provider: 'openai', model: 'gpt-4.1' })
    expect(r2.model).toBe('gpt-4.1')
  })

  it('選んだプロバイダのAPIキーが無ければ 400 で失敗し、別プロバイダに倒さない', () => {
    const noOpenai = { ...env, openaiKey: undefined }
    expect(() => resolveLlmSelection(noOpenai, { llmProvider: 'openai', llmModel: null })).toThrow(/OPENAI_API_KEY/)
    expect(() => resolveLlmSelection({ ...env, anthropicKey: undefined }, null)).toThrow(/ANTHROPIC_API_KEY/)
  })
})
