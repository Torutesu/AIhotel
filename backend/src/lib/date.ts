// 日付ユーティリティ（C-6）。
//
// このシステムの「日付」は常に JST（日本時間）の暦日を指し、DB には
// その暦日の 00:00:00 UTC（= date-only の Date）として保存する。
// コンテナのタイムゾーンは UTC のことが多く、`new Date()` をそのまま
// 日付として使うと JST の 00:00〜08:59 に前日として扱われてしまうため、
// 「今日」の判定は必ず todayJst() を経由すること。
//
// 各サービスに散っていた monthRange / dateOnly / addDays の重複実装を
// ここに集約している。

/** JST のオフセット（UTC+9）ミリ秒 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 週末のデフォルト定義（金=5・土=6 — 要件定義書 F-DAILY-02）。
 *  ホテル個別の設定は Hotel.weekendDays を優先し、未設定時のみこの値を使う。 */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [5, 6]

/**
 * Date を「時刻を切り落とした UTC の暦日」に丸める。
 * 入力の UTC 上の年月日をそのまま使う（タイムゾーン変換はしない）。
 */
export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * 「今日」（JST の暦日）を date-only の Date で返す。
 * 例: 2026-09-11T23:30:00Z（JST では 9/12 08:30）→ 2026-09-12T00:00:00Z
 *
 * @param now テスト用に基準時刻を差し替えるための引数。既定は現在時刻。
 */
export function todayJst(now: Date = new Date()): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()))
}

/** UTC 基準で日数を加算した新しい Date を返す（元の Date は変更しない） */
export function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * 指定した年月の範囲。
 * start は月初 00:00:00 UTC、end は翌月初 00:00:00 UTC（終端を含まない半開区間）。
 */
export function monthRange(
  year: number,
  month: number
): { start: Date; end: Date; daysInMonth: number } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
    // Date.UTC(year, month, 0) は「翌月の0日」＝当月末日
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  }
}
