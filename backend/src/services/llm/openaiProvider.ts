// OpenAI（ChatGPT / GPT）プロバイダ。Responses API の構造化出力（json_schema, strict）で JSON を受け取る。
// openai SDK v7 は zod v4 の zodTextFormat / responses.parse に対応している
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod/v4'
import { BadRequestError } from '../../middlewares/errorHandler.js'
import type { LlmProvider, StructuredRequest, StructuredResponse } from './types.js'

export function createOpenAiProvider(apiKey: string, model: string, baseURL?: string): LlmProvider {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  return {
    name: 'openai',
    model,
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResponse<z.infer<T>>> {
      const response = await client.responses.parse({
        model,
        instructions: req.system,
        input: req.user,
        max_output_tokens: req.maxOutputTokens,
        text: { format: zodTextFormat(req.schema, req.schemaName) },
      })
      const refusal = response.output
        .flatMap((item) => (item.type === 'message' ? item.content : []))
        .find((c) => c.type === 'refusal')
      if (refusal) {
        throw new BadRequestError(`OpenAI（${model}）がこの内容の処理を拒否しました: ${refusal.refusal}`)
      }
      if (response.status === 'incomplete') {
        throw new BadRequestError(
          `OpenAI（${model}）の出力が途中で終了しました（${response.incomplete_details?.reason ?? '理由不明'}）。ページが長すぎる可能性があります`
        )
      }
      if (!response.output_parsed) {
        throw new BadRequestError(`OpenAI（${model}）の応答を解釈できませんでした（構造化出力が空）`)
      }
      return {
        parsed: response.output_parsed as z.infer<T>,
        provider: 'openai',
        model,
        usage: { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null },
      }
    },
  }
}
