// ツール入力スキーマ（zod v4）→ JSON Schema。両プロバイダ共通
import { z } from 'zod/v4'
import type { ToolDefinition } from './types.js'

export function toolInputJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.inputSchema, { target: 'draft-7' }) as Record<string, unknown>
  delete schema.$schema
  return schema
}

/** ツール実行の共通ラッパ: 例外をモデルに返せる形にする */
export async function runToolSafely(execute: (name: string, input: unknown) => Promise<unknown>, name: string, input: unknown): Promise<{ ok: boolean; output: unknown }> {
  try {
    const output = await execute(name, input)
    return { ok: true, output }
  } catch (err) {
    return { ok: false, output: { error: err instanceof Error ? err.message : String(err) } }
  }
}

export function stringifyToolOutput(output: unknown): string {
  const s = JSON.stringify(output ?? null)
  // モデルに返す量を抑える（大きすぎる読み取り結果は先頭だけ）
  return s.length > 12000 ? `${s.slice(0, 12000)}…(truncated)` : s
}
