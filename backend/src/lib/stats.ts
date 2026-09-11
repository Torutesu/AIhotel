// 数値集約のユーティリティ（C-9）。
//
// 競合料金の代表値には「平均」ではなく中央値を使う（要件定義書は指標名としての
// 「平均」表現を禁じている）。競合が数社しかない前提では、1社の極端な価格に
// 引きずられない中央値のほうが代表値として妥当でもある。

/** 中央値。要素が無ければ null。偶数個なら中央2値の平均を四捨五入して返す */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** 最小値。要素が無ければ null */
export function minOf(values: number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null
}

/** 最大値。要素が無ければ null */
export function maxOf(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null
}

/**
 * 平均値。要素が無ければ null。
 * @deprecated 「平均」表現は廃止予定（C-9）。新しいフィールドでは median を使うこと。
 *   既存フィールド（avgPrice / competitorAvgPrice）の後方互換のためだけに残している。
 */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
}
