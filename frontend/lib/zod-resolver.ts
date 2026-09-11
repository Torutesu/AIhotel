// react-hook-form 用の zod リゾルバ（U-11）
// @hookform/resolvers を追加せずに済むよう、必要最小限の変換だけを行う。

import type { FieldValues, Resolver } from "react-hook-form"
import type { z } from "zod"

/**
 * zod スキーマを react-hook-form の resolver に変換する。
 * 各フィールドの最初のエラーメッセージだけを採用する（インライン表示用）。
 */
export function zodResolver<TSchema extends z.ZodType<FieldValues>>(
  schema: TSchema,
): Resolver<z.infer<TSchema>> {
  return async (values) => {
    const result = schema.safeParse(values)
    if (result.success) {
      return { values: result.data as z.infer<TSchema>, errors: {} }
    }

    const errors: Record<string, { type: string; message: string }> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "root"
      if (!errors[path]) {
        errors[path] = { type: issue.code, message: issue.message }
      }
    }
    return { values: {}, errors: errors as never }
  }
}
