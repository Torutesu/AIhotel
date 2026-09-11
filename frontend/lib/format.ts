// 数値表示の共通フォーマッタ（U-15）
// 各タブで yen()/pct()/formatYen() を重複定義していたものをここへ集約する。
// null / undefined は「値なし」として一律 "-" にする（0 と区別する）。

const DASH = "-"

/** 円表記（小数は四捨五入） */
export function formatYen(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH
  return `¥${Math.round(value).toLocaleString()}`
}

/** 符号付きの円表記（差分表示用） */
export function formatSignedYen(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH
  return `${value >= 0 ? "+" : "-"}¥${Math.abs(Math.round(value)).toLocaleString()}`
}

/** 比率（0〜1）をパーセント表記にする */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return DASH
  return `${(value * 100).toFixed(digits)}%`
}

/** 比率（0〜1）の差分をポイント表記にする */
export function formatSignedPt(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return DASH
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}pt`
}

/** すでにパーセント値（0〜100）になっている数値を符号付きで表記する */
export function formatPt(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return DASH
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}

/** 室数表記 */
export function formatRooms(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH
  return `${Math.round(value).toLocaleString()}室`
}

/** 人数表記 */
export function formatGuests(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH
  return `${Math.round(value).toLocaleString()}人`
}

/** 実績 ÷ 目標 の達成率。どちらかが欠けていれば "-" */
export function formatRatio(
  actual: number | null | undefined,
  target: number | null | undefined,
): string {
  if (actual == null || target == null || target === 0) return DASH
  return `${((actual / target) * 100).toFixed(1)}%`
}

/** 達成率が 95% を下回っているか（警告表示の判定） */
export function isRatioNegative(
  actual: number | null | undefined,
  target: number | null | undefined,
): boolean {
  if (actual == null || target == null || target === 0) return false
  return actual / target < 0.95
}

/** null を含む配列の平均。有効値が無ければ null */
export function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => v != null && !Number.isNaN(v))
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

/**
 * 決定的な擬似乱数（サンプル表示の生成にのみ使う）。
 * 実データを表示する箇所では使用しないこと。
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}
