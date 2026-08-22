// 日本の国民の祝日・振替休日・国民の休日（内閣府「国民の祝日について」準拠）。
//
// 出典: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html の公表CSV
// （syukujitsu.csv）を元に静的データとして保持する。春分・秋分は前年2月の
// 官報公示で確定するため、毎年公表後にこのファイルへ翌年分を追記すること。
// カバー範囲外の年は「祝日情報なし」として扱い、補正を適用しない
// （エラーにせず、確信度側で織り込む方針。docs/algorithm-design.md §3.4）。
//
// 外部要因の本格的な取り込み（ExternalFactorDaily テーブル・asOfDate管理）は
// v2 で行う。本ファイルは v1.5 の暫定実装（docs/algorithm-design.md §5）。

/** 祝日データのカバー範囲（この範囲外の年は hasHolidayData() が false を返す） */
export const HOLIDAY_DATA_RANGE = { fromYear: 2024, toYear: 2027 } as const

// 'YYYY-MM-DD' → 祝日名
const JP_HOLIDAYS: Record<string, string> = {
  // 2024
  '2024-01-01': '元日',
  '2024-01-08': '成人の日',
  '2024-02-11': '建国記念の日',
  '2024-02-12': '休日',
  '2024-02-23': '天皇誕生日',
  '2024-03-20': '春分の日',
  '2024-04-29': '昭和の日',
  '2024-05-03': '憲法記念日',
  '2024-05-04': 'みどりの日',
  '2024-05-05': 'こどもの日',
  '2024-05-06': '休日',
  '2024-07-15': '海の日',
  '2024-08-11': '山の日',
  '2024-08-12': '休日',
  '2024-09-16': '敬老の日',
  '2024-09-22': '秋分の日',
  '2024-09-23': '休日',
  '2024-10-14': 'スポーツの日',
  '2024-11-03': '文化の日',
  '2024-11-04': '休日',
  '2024-11-23': '勤労感謝の日',
  // 2025
  '2025-01-01': '元日',
  '2025-01-13': '成人の日',
  '2025-02-11': '建国記念の日',
  '2025-02-23': '天皇誕生日',
  '2025-02-24': '休日',
  '2025-03-20': '春分の日',
  '2025-04-29': '昭和の日',
  '2025-05-03': '憲法記念日',
  '2025-05-04': 'みどりの日',
  '2025-05-05': 'こどもの日',
  '2025-05-06': '休日',
  '2025-07-21': '海の日',
  '2025-08-11': '山の日',
  '2025-09-15': '敬老の日',
  '2025-09-23': '秋分の日',
  '2025-10-13': 'スポーツの日',
  '2025-11-03': '文化の日',
  '2025-11-23': '勤労感謝の日',
  '2025-11-24': '休日',
  // 2026
  '2026-01-01': '元日',
  '2026-01-12': '成人の日',
  '2026-02-11': '建国記念の日',
  '2026-02-23': '天皇誕生日',
  '2026-03-20': '春分の日',
  '2026-04-29': '昭和の日',
  '2026-05-03': '憲法記念日',
  '2026-05-04': 'みどりの日',
  '2026-05-05': 'こどもの日',
  '2026-05-06': '休日',
  '2026-07-20': '海の日',
  '2026-08-11': '山の日',
  '2026-09-21': '敬老の日',
  '2026-09-22': '休日', // 敬老の日と秋分の日に挟まれた国民の休日
  '2026-09-23': '秋分の日',
  '2026-10-12': 'スポーツの日',
  '2026-11-03': '文化の日',
  '2026-11-23': '勤労感謝の日',
  // 2027
  '2027-01-01': '元日',
  '2027-01-11': '成人の日',
  '2027-02-11': '建国記念の日',
  '2027-02-23': '天皇誕生日',
  '2027-03-21': '春分の日',
  '2027-03-22': '休日',
  '2027-04-29': '昭和の日',
  '2027-05-03': '憲法記念日',
  '2027-05-04': 'みどりの日',
  '2027-05-05': 'こどもの日',
  '2027-07-19': '海の日',
  '2027-08-11': '山の日',
  '2027-09-20': '敬老の日',
  '2027-09-23': '秋分の日',
  '2027-10-11': 'スポーツの日',
  '2027-11-03': '文化の日',
  '2027-11-23': '勤労感謝の日',
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/** 祝日データが存在する年か（範囲外の日付には補正を適用しない） */
export function hasHolidayData(date: Date): boolean {
  const year = date.getUTCFullYear()
  return year >= HOLIDAY_DATA_RANGE.fromYear && year <= HOLIDAY_DATA_RANGE.toYear
}

/** 国民の祝日・振替休日・国民の休日か */
export function isJpHoliday(date: Date): boolean {
  return toKey(date) in JP_HOLIDAYS
}

/** 祝日名（祝日でなければ null） */
export function getJpHolidayName(date: Date): string | null {
  return JP_HOLIDAYS[toKey(date)] ?? null
}

/**
 * 「休み」= 祝日または土日（カレンダー上の社会一般の休み）。
 * Hotel.weekendDays は「宿泊需要が高いチェックイン曜日」（金・土等）の定義であり
 * 意味が異なるため、連休判定にはこちらの定義を使う。
 */
export function isDayOff(date: Date): boolean {
  const dow = date.getUTCDay()
  return dow === 0 || dow === 6 || isJpHoliday(date)
}

export interface HolidayBlock {
  /** 連休の長さ（日数） */
  length: number
  /** ブロック内での位置（1始まり。length と等しければ連休最終日） */
  position: number
}

/**
 * 対象日を含む連続した「休み」の区間（祝日を1日以上含むもの）を返す。
 * 土日のみの通常週末は連休として扱わない（週末補正と役割を分けるため）。
 * 対象日が休みでない場合、祝日データがない年の場合は null。
 */
export function getConsecutiveHolidayBlock(date: Date): HolidayBlock | null {
  if (!hasHolidayData(date) || !isDayOff(date)) return null

  let start = date
  while (isDayOff(addUtcDays(start, -1))) start = addUtcDays(start, -1)
  let end = date
  while (isDayOff(addUtcDays(end, 1))) end = addUtcDays(end, 1)

  // 祝日を含まない区間（＝通常の土日）は連休ではない
  let containsHoliday = false
  for (let d = start; d <= end; d = addUtcDays(d, 1)) {
    if (isJpHoliday(d)) {
      containsHoliday = true
      break
    }
  }
  if (!containsHoliday) return null

  const length = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const position = Math.round((date.getTime() - start.getTime()) / 86_400_000) + 1
  return { length, position }
}
