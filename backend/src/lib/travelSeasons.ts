import { holidayName } from './jpHolidays.js'

// 旅行（宿泊）の時間軸の分類（D-13。先方の資料「外部要因と旅行（宿泊）の関連付け」の a. 特日）。
// 日の背景（services/forecast/dayPattern.ts）で「同じシーズンの日」を近い日として探すために使う。
// 地域差のあるもの（受験・夏休み）は全国の目安。春節は旧暦なので年ごとの日付の表を持つ。日付は UTC の 0時で受け取る。

export type TravelSeasonKey =
  | 'yearEnd' // 年末年始
  | 'postNewYear' // 正月明け（1年で全国的に稼働が一番落ちる時期）
  | 'entranceExam' // 受験
  | 'lunarNewYear' // 中国春節（インバウンド）
  | 'springBreak' // 春休み（ファミリー層）
  | 'goldenWeek' // ゴールデンウィーク
  | 'summerBreak' // 夏休み
  | 'obon' // お盆
  | 'silverWeek' // シルバーウィーク

export const TRAVEL_SEASON_LABELS: Record<TravelSeasonKey, string> = {
  yearEnd: '年末年始',
  postNewYear: '正月明け',
  entranceExam: '受験',
  lunarNewYear: '中国春節',
  springBreak: '春休み',
  goldenWeek: 'ゴールデンウィーク',
  summerBreak: '夏休み',
  obon: 'お盆',
  silverWeek: 'シルバーウィーク',
}

/** 春節（旧正月の元日）。中国の連休は元日の前日から約8日、帰省・旅行の動きは前後に広がる */
export const LUNAR_NEW_YEAR: Record<number, string> = {
  2015: '2015-02-19',
  2016: '2016-02-08',
  2017: '2017-01-28',
  2018: '2018-02-16',
  2019: '2019-02-05',
  2020: '2020-01-25',
  2021: '2021-02-12',
  2022: '2022-02-01',
  2023: '2023-01-22',
  2024: '2024-02-10',
  2025: '2025-01-29',
  2026: '2026-02-17',
  2027: '2027-02-06',
  2028: '2028-01-26',
  2029: '2029-02-13',
  2030: '2030-02-03',
  2031: '2031-01-23',
  2032: '2032-02-11',
  2033: '2033-01-31',
  2034: '2034-02-19',
  2035: '2035-02-08',
}
/** 春節の影響を見る範囲（元日からの日数） */
const LUNAR_NEW_YEAR_FROM = -7
const LUNAR_NEW_YEAR_TO = 10

const DAY_MS = 86_400_000
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const inRange = (date: Date, from: Date, to: Date) => from <= date && date <= to

/** その月の第 n 週目の日曜（1 = 最初の日曜） */
function nthSunday(y: number, m: number, n: number): Date {
  const first = utc(y, m, 1)
  const offset = (7 - first.getUTCDay()) % 7
  return utc(y, m, 1 + offset + (n - 1) * 7)
}

/** その年の、名前が name の祝日（7月の海の日・8月の山の日など）。見つからなければ null */
function holidayIn(y: number, m: number, name: string): Date | null {
  for (let d = 1; d <= 31; d++) {
    const date = utc(y, m, d)
    if (date.getUTCMonth() !== m - 1) break
    if (holidayName(date) === name) return date
  }
  return null
}

/** その日にかかる旅行シーズン（重なることがある。例: 1月下旬は受験と春節） */
export function travelSeasonsOf(date: Date): TravelSeasonKey[] {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  const result: TravelSeasonKey[] = []

  if ((m === 12 && d >= 27) || (m === 1 && d <= 5)) result.push('yearEnd')
  // 正月明け: 1/4〜1月の第4週の終わり（第4日曜の翌土曜）
  if (m === 1 && d >= 4 && date <= new Date(nthSunday(y, 1, 4).getTime() + 6 * DAY_MS)) result.push('postNewYear')
  // 受験: 1月中旬〜2月中旬
  if ((m === 1 && d >= 11) || (m === 2 && d <= 20)) result.push('entranceExam')
  const lny = LUNAR_NEW_YEAR[y]
  if (lny) {
    const day = new Date(`${lny}T00:00:00Z`)
    if (inRange(date, new Date(day.getTime() + LUNAR_NEW_YEAR_FROM * DAY_MS), new Date(day.getTime() + LUNAR_NEW_YEAR_TO * DAY_MS))) {
      result.push('lunarNewYear')
    }
  }
  // 春休み: 3/15〜4月の第1週の終わり（第1日曜）
  if ((m === 3 && d >= 15) || (m === 4 && date <= nthSunday(y, 4, 1))) result.push('springBreak')
  if ((m === 4 && d >= 28) || (m === 5 && d <= 6)) result.push('goldenWeek')
  // 夏休み: 海の日〜8/31（地域差あり）
  const marine = holidayIn(y, 7, '海の日') ?? utc(y, 7, 20)
  if (inRange(date, marine, utc(y, 8, 31))) result.push('summerBreak')
  // お盆: 山の日〜8/16
  const mountain = holidayIn(y, 8, '山の日') ?? utc(y, 8, 11)
  if (inRange(date, mountain, utc(y, 8, 16))) result.push('obon')
  // シルバーウィーク: 敬老の日の連休（土〜月）と秋分の日。間が3日以内なら続けて1つの連休にする
  const respect = holidayIn(y, 9, '敬老の日')
  const equinox = holidayIn(y, 9, '秋分の日')
  if (respect && equinox) {
    const gap = (equinox.getTime() - respect.getTime()) / DAY_MS
    const ranges: Array<[Date, Date]> = [[new Date(respect.getTime() - 2 * DAY_MS), respect]]
    if (gap <= 3) ranges[0][1] = equinox
    else {
      const dow = equinox.getUTCDay()
      // 金曜なら日曜まで、月曜なら前の土曜から（3連休になる並び）
      const from = dow === 1 ? new Date(equinox.getTime() - 2 * DAY_MS) : equinox
      const to = dow === 5 ? new Date(equinox.getTime() + 2 * DAY_MS) : equinox
      ranges.push([from, to])
    }
    if (ranges.some(([from, to]) => inRange(date, from, to))) result.push('silverWeek')
  }
  return result
}
