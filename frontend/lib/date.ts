// 日付まわりの共通ユーティリティ（U-6 / U-15）
// 各タブに散在していた曜日配列・"yyyy-MM-dd" 変換・週末判定をここへ集約する。
// 週末の定義は必ず Hotel.weekendDays 由来の配列を引数で受け取り、ハードコードしない。

/** 曜日ラベル（0=日曜 〜 6=土曜） */
export const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"] as const

/** 「月曜日」形式の曜日ラベル（0=日曜 〜 6=土曜） */
export const DAY_FULL_NAMES = [
  "日曜日",
  "月曜日",
  "火曜日",
  "水曜日",
  "木曜日",
  "金曜日",
  "土曜日",
] as const

/** 週末定義が取得できていないときの既定値（金・土 — 要件定義書 §4） */
export const DEFAULT_WEEKEND_DAYS: number[] = [5, 6]

/** Date を "yyyy-MM-dd"（ローカル時刻基準）に整形する */
export function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`
}

/** Date を "yyyy-MM"（ローカル時刻基準）に整形する */
export function toMonthStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

/** "yyyy-MM" を { year, month }（month は 1-12）に分解する。不正値は現在年月にフォールバックする */
export function parseMonthStr(value: string): { year: number; month: number } {
  const [yearStr, monthStr] = value.split("-")
  const year = Number.parseInt(yearStr ?? "", 10)
  const month = Number.parseInt(monthStr ?? "", 10)
  const now = new Date()
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return { year, month }
}

/** 対象月の初日・末日を "yyyy-MM-dd" で返す */
export function monthRange(year: number, month: number): { startDate: string; endDate: string } {
  return {
    startDate: toDateStr(new Date(year, month - 1, 1)),
    endDate: toDateStr(new Date(year, month, 0)),
  }
}

/** その月の日数 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** "yyyy年M月" 形式のラベル */
export function monthLabel(year: number, month: number): string {
  return `${year}年${month}月`
}

/**
 * 未知の値（Prisma の Json 由来など）を週末定義の配列へ正規化する。
 * 0〜6 の整数のみを採用し、空になった場合は既定値（金・土）を返す。
 */
export function parseWeekendDays(value: unknown): number[] {
  if (Array.isArray(value)) {
    const days = value.filter(
      (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6,
    )
    if (days.length > 0) return [...new Set(days)].sort((a, b) => a - b)
  }
  return DEFAULT_WEEKEND_DAYS
}

/** 指定した曜日番号が週末かどうか（weekendDays は Hotel.weekendDays 由来） */
export function isWeekendDow(dow: number, weekendDays: number[]): boolean {
  return weekendDays.includes(dow)
}

/** 指定した日付が週末かどうか（weekendDays は Hotel.weekendDays 由来） */
export function isWeekendDate(date: Date, weekendDays: number[]): boolean {
  return isWeekendDow(date.getDay(), weekendDays)
}

/** 週末定義を「金・土」のような読み上げ用ラベルにする */
export function weekendDaysLabel(weekendDays: number[]): string {
  if (weekendDays.length === 0) return "設定なし"
  return weekendDays.map((d) => DAY_NAMES[d]).join("・")
}

/** 今日の 0 時（ローカルタイム） */
export function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}
