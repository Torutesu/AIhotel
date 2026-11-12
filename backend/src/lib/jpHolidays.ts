import { JP_HOLIDAYS, JP_HOLIDAYS_LAST_YEAR } from './jpHolidaysData.js'

// 日本の祝日（内閣府「国民の祝日」— D-13）と、連休の並び。
//
// 一覧は同梱データ（scripts/update-jp-holidays.mjs が内閣府 CSV から作る）。本番は外部要因ジョブ（job external-signals）が
// 同じ CSV をストレージに保存し、registerHolidays() で同梱分より新しい年を足す（コードを出し直さなくても翌年分が入る）。
// 一覧に無い年（内閣府がまだ公開していない年）は、日付の決まった祝日だけで近似する。
// 日付は UTC の 0時（日付だけ）で受け取る。

const DAY_MS = 86_400_000

/** 日付の決まった祝日（一覧に無い年の近似用。移動祝日・振替休日は含まない） */
const FIXED_DATE_HOLIDAYS: Record<string, string> = {
  '01-01': '元日',
  '02-11': '建国記念の日',
  '02-23': '天皇誕生日',
  '04-29': '昭和の日',
  '05-03': '憲法記念日',
  '05-04': 'みどりの日',
  '05-05': 'こどもの日',
  '08-11': '山の日',
  '11-03': '文化の日',
  '11-23': '勤労感謝の日',
}

const holidays = new Map<string, string>(Object.entries(JP_HOLIDAYS))
let lastKnownYear = JP_HOLIDAYS_LAST_YEAR

const iso = (date: Date) => date.toISOString().slice(0, 10)

/**
 * 内閣府の CSV（「国民の祝日・休日月日,国民の祝日・休日名称」。文字コードは呼び出し側で UTF-8 にしてから渡す）を読む。
 * 形式に合わない行は飛ばす
 */
export function parseCabinetOfficeHolidayCsv(text: string): Array<{ date: string; name: string }> {
  const rows: Array<{ date: string; name: string }> = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.+)$/)
    if (!m) continue
    rows.push({ date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, name: m[4].trim() })
  }
  return rows
}

/**
 * 取得した祝日を足す。同梱分より新しい年だけを足す（同梱分は内閣府の確定値なので上書きしない）。足した件数を返す
 */
export function registerHolidays(rows: Array<{ date: string; name: string }>): number {
  let added = 0
  let maxYear = lastKnownYear
  for (const row of rows) {
    const year = Number(row.date.slice(0, 4))
    if (year <= JP_HOLIDAYS_LAST_YEAR || holidays.has(row.date)) continue
    holidays.set(row.date, row.name)
    maxYear = Math.max(maxYear, year)
    added++
  }
  lastKnownYear = maxYear
  return added
}

/** 祝日の一覧がある最後の年（これより先は日付の決まった祝日だけの近似） */
export function holidaysKnownThrough(): number {
  return lastKnownYear
}

/** 祝日の名前。祝日でなければ null */
export function holidayName(date: Date): string | null {
  const key = iso(date)
  if (date.getUTCFullYear() <= lastKnownYear) return holidays.get(key) ?? null
  return FIXED_DATE_HOLIDAYS[key.slice(5)] ?? null
}

/** 休日（土日・祝日）か。ホテルの「週末」（Hotel.weekendDays = 需要の高い泊）とは別の、世の中の休み */
export function isDayOff(date: Date): boolean {
  const dow = date.getUTCDay()
  return dow === 0 || dow === 6 || holidayName(date) != null
}

export interface HolidayRun {
  /** この泊の翌日が休日か（休前日。宿泊の需要が高い泊） */
  beforeDayOff: boolean
  /** この泊の翌日から続く休日の日数（0 = 翌日は平日）。3連休の初日の前夜なら 3 */
  daysOffAhead: number
  /** この日が休日の並びの何日目か（休日でなければ 0） */
  positionInRun: number
  /** この日を含む休日の並びの長さ（休日でなければ 0） */
  runLength: number
}

const MAX_RUN = 16

/** 宿泊日（泊）から見た連休の並び。「3連休の中日」「飛び石」などを日の特徴にするために使う */
export function holidayRunOf(date: Date): HolidayRun {
  let daysOffAhead = 0
  while (daysOffAhead < MAX_RUN && isDayOff(new Date(date.getTime() + (daysOffAhead + 1) * DAY_MS))) daysOffAhead++
  let positionInRun = 0
  let runLength = 0
  if (isDayOff(date)) {
    let before = 0
    while (before < MAX_RUN && isDayOff(new Date(date.getTime() - (before + 1) * DAY_MS))) before++
    positionInRun = before + 1
    runLength = before + 1 + daysOffAhead
  }
  return { beforeDayOff: daysOffAhead > 0, daysOffAhead, positionInRun, runLength }
}
