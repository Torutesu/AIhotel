// recharts のカスタムツールチップ用の型ヘルパー（F-6）
//
// `<Tooltip content={<MyTooltip />} />` の形で使うため、props はすべて任意にしている
// （recharts が実行時に active / payload / label を注入する）。

import type { TooltipContentProps } from "recharts"

/** カスタムツールチップコンポーネントの props */
export type ChartTooltipProps = Partial<TooltipContentProps<number, string>>

/** payload の 1 要素（系列ごとの値） */
export type ChartTooltipEntry = NonNullable<ChartTooltipProps["payload"]>[number]

/**
 * recharts の payload 値は `number | string | 配列` になりうるため数値へ正規化する。
 * 数値にできない場合は 0 を返す。
 */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
