// zod のオブジェクト全体のチェックの共通設定（backend の validators.ts と frontend のフォームで同じものを使う）。
// zod には依存しない（型は最小限の形で受ける）。backend は dist（shared の build）を実行時に読み込む。

/** 全体のチェックが出したエラーの目印（項目のエラーと見分けるため） */
const OBJECT_CHECK_PARAMS = { objectCheck: true } as const

/**
 * オブジェクト全体の追加チェック（期間の前後・合計100%・料金の大小・確認用パスワードの一致など）を、
 * 中の項目がすべて合格したときだけ動かす。
 * zod 4 は中の項目が不合格でも追加チェックを動かすため、日付に変換される前の文字列が渡って例外（500）になったり、
 * 項目のエラーと全体のエラーが重なって出たりする。zod 3 と同じく、項目のエラーがあるときは項目のエラーだけを返す。
 * ほかの全体のチェックのエラー（params の目印つき）は項目のエラーに数えないので、全体のチェックは前のものが
 * 不合格でもすべて動き、エラーをまとめて返す（zod 3 と同じ）。
 *
 * - refine: `{ ...ifFieldsValid, message }` を渡す
 * - superRefine: `{ when: ifFieldsValid.when }` を渡し、addIssue に `params: ifFieldsValid.params` を付ける
 */
export const ifFieldsValid = {
  params: OBJECT_CHECK_PARAMS,
  when: (payload: { issues: readonly unknown[] }): boolean =>
    payload.issues.every((issue) => (issue as { params?: Record<string, unknown> }).params?.objectCheck === true),
}
