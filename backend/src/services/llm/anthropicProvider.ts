// Anthropic（Claude）プロバイダ。Messages API の構造化出力（zod スキーマ）で JSON を受け取る
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod/v4'
import { BadRequestError } from '../../middlewares/errorHandler.js'
import type { LlmProvider, StructuredRequest, StructuredResponse } from './types.js'

export function createAnthropicProvider(apiKey: string, model: string): LlmProvider {
  const client = new Anthropic({ apiKey })
  return {
    name: 'anthropic',
    model,
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResponse<z.infer<T>>> {
      const response = await client.messages.parse({
        model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: zodOutputFormat(req.schema) },
      })
      if (response.stop_reason === 'refusal') {
        throw new BadRequestError(`Claude（${model}）がこの内容の処理を拒否しました`)
      }
      if (response.stop_reason === 'max_tokens') {
        throw new BadRequestError(`Claude（${model}）の出力が上限（${req.maxOutputTokens}トークン）に達しました。ページが長すぎる可能性があります`)
      }
      if (!response.parsed_output) {
        throw new BadRequestError(`Claude（${model}）の応答を解釈できませんでした（構造化出力が空）`)
      }
      return {
        parsed: response.parsed_output,
        provider: 'anthropic',
        model,
        usage: { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null },
      }
    },
  }
}
