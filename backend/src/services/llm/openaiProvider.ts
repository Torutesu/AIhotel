// OpenAI（ChatGPT / GPT）プロバイダ。Responses API の構造化出力（json_schema, strict）で JSON を受け取る。
// openai SDK v7 は zod v4 の zodTextFormat / responses.parse に対応している
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod/v4'
import { BadRequestError } from '../../middlewares/errorHandler.js'
import type { LlmProvider, StructuredRequest, StructuredResponse, ToolCallRecord, ToolsRequest, ToolsResponse } from './types.js'
import { runToolSafely, stringifyToolOutput, toolInputJsonSchema } from './toolSchema.js'

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

    async generateWithTools(req: ToolsRequest): Promise<ToolsResponse> {
      const tools: OpenAI.Responses.FunctionTool[] = req.tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: toolInputJsonSchema(t),
        strict: false,
      }))
      const input: OpenAI.Responses.ResponseInputItem[] = req.messages.map((m) => ({ role: m.role, content: m.content }))
      const toolCalls: ToolCallRecord[] = []
      let inputTokens = 0
      let outputTokens = 0
      let finalText = ''

      for (let turn = 0; turn < req.maxTurns; turn++) {
        const response = await client.responses.create({
          model,
          instructions: req.system,
          input,
          tools,
          max_output_tokens: req.maxOutputTokens,
        })
        inputTokens += response.usage?.input_tokens ?? 0
        outputTokens += response.usage?.output_tokens ?? 0
        const refusal = response.output.flatMap((item) => (item.type === 'message' ? item.content : [])).find((c) => c.type === 'refusal')
        if (refusal) throw new BadRequestError(`OpenAI（${model}）がこの内容の処理を拒否しました: ${refusal.refusal}`)
        finalText = response.output_text?.trim() || finalText

        const calls = response.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call')
        if (calls.length === 0) break

        for (const item of response.output) input.push(item as OpenAI.Responses.ResponseInputItem)
        for (const call of calls) {
          let parsed: unknown = {}
          try {
            parsed = call.arguments ? JSON.parse(call.arguments) : {}
          } catch {
            parsed = { _parseError: call.arguments }
          }
          const r = await runToolSafely(req.execute, call.name, parsed)
          toolCalls.push({ name: call.name, input: parsed, output: r.output, ok: r.ok })
          input.push({ type: 'function_call_output', call_id: call.call_id, output: stringifyToolOutput(r.output) })
        }
      }
      return { text: finalText, toolCalls, provider: 'openai', model, usage: { inputTokens, outputTokens } }
    },
  }
}
