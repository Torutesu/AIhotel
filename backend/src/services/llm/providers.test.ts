import { describe, it, expect } from 'vitest'
import { zodTextFormat } from 'openai/helpers/zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { ExtractionResultSchema } from '../events/venueExtraction.js'

// 両プロバイダの構造化出力ヘルパーが、実際に使う抽出スキーマ（zod v4）を JSON Schema に変換できることを確認する。
// OpenAI の strict モードは全プロパティ必須・additionalProperties=false を要求する
describe('構造化出力スキーマの互換性', () => {
  it('OpenAI: zodTextFormat が strict な json_schema を生成する', () => {
    const fmt = zodTextFormat(ExtractionResultSchema, 'venue_events') as unknown as { type: string; name: string; strict?: boolean; schema: Record<string, unknown> }
    expect(fmt.type).toBe('json_schema')
    expect(fmt.name).toBe('venue_events')
    expect(fmt.strict).toBe(true)
    expect(fmt.schema.additionalProperties).toBe(false)
    expect(fmt.schema.required).toEqual(expect.arrayContaining(['events', 'notes']))
  })

  it('Anthropic: zodOutputFormat がスキーマを生成する', () => {
    const fmt = zodOutputFormat(ExtractionResultSchema) as unknown as { type: string; schema: Record<string, unknown> }
    expect(fmt.type).toBe('json_schema')
    expect(fmt.schema).toBeTruthy()
  })
})
