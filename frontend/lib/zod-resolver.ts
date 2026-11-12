// react-hook-form 用の zod リゾルバ（U-11）
// @hookform/resolvers を追加せずに済むよう、必要最小限の変換だけを行う。

import type { FieldValues, Resolver } from "react-hook-form"
import type { z } from "zod"

/** 全体のチェックが出したエラーの目印（項目のエラーと見分けるため） */
const OBJECT_CHECK_PARAMS = { objectCheck: true } as const

/**
 * オブジェクト全体のチェック（料金の大小・確認用パスワードの一致など）を、各項目がすべて合格したときだけ動かす。
 * zod 4 は項目が不合格でも全体のチェックを動かすため、項目のエラーと全体のエラーが重なって出る。zod 3 と同じく項目のエラーを先に出す。
 * ほかの全体のチェックのエラー（params の目印つき）は項目のエラーに数えないので、全体のチェックはすべて動く（zod 3 と同じ）。
 * superRefine では `{ when: ifFieldsValid.when }` を渡し、addIssue に `params: ifFieldsValid.params` を付ける。
 * バックエンドの validators.ts にも同じものがある（バックエンドは shared の実行時コードを読み込めないため）
 */
export const ifFieldsValid = {
  params: OBJECT_CHECK_PARAMS,
  when: (payload: { issues: readonly unknown[] }) =>
    payload.issues.every((issue) => (issue as { params?: Record<string, unknown> }).params?.objectCheck === true),
}

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
