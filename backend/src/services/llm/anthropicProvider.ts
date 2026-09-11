// Anthropic（Claude）プロバイダ。Messages API の構造化出力（zod スキーマ）で JSON を受け取る
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod/v4'
import { BadRequestError } from '../../middlewares/errorHandler.js'
import type { LlmProvider, StructuredRequest, StructuredResponse, ToolCallRecord, ToolsRequest, ToolsResponse } from './types.js'
import { runToolSafely, stringifyToolOutput, toolInputJsonSchema } from './toolSchema.js'

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

    async generateWithTools(req: ToolsRequest): Promise<ToolsResponse> {
      const tools: Anthropic.Tool[] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: toolInputJsonSchema(t) as Anthropic.Tool['input_schema'],
      }))
      const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }))
      const toolCalls: ToolCallRecord[] = []
      let inputTokens = 0
      let outputTokens = 0
      let finalText = ''

      for (let turn = 0; turn < req.maxTurns; turn++) {
        const response = await client.messages.create({
          model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages,
          tools,
        })
        inputTokens += response.usage?.input_tokens ?? 0
        outputTokens += response.usage?.output_tokens ?? 0
        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        finalText = textBlocks.map((b) => b.text).join('\n').trim() || finalText

        if (response.stop_reason === 'refusal') throw new BadRequestError(`Claude（${model}）がこの内容の処理を拒否しました`)
        if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break

        messages.push({ role: 'assistant', content: response.content })
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const use of toolUses) {
          const r = await runToolSafely(req.execute, use.name, use.input)
          toolCalls.push({ name: use.name, input: use.input, output: r.output, ok: r.ok })
          results.push({ type: 'tool_result', tool_use_id: use.id, content: stringifyToolOutput(r.output), is_error: !r.ok })
        }
        messages.push({ role: 'user', content: results })
      }
      return { text: finalText, toolCalls, provider: 'anthropic', model, usage: { inputTokens, outputTokens } }
    },
  }
}
