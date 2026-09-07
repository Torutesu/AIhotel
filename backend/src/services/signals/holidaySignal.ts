// 祝日・連休・特別期間・学校休暇シグナル（docs/外部要因設計.md §3 #1, #2）。
//
// テナント非依存の静的データ（src/data/jpHolidays.ts）から、宿泊日 d に対する
// 需要側の特徴量を純粋関数で計算する。DB アクセスなし。
//
// 「休み」の判定はゲスト側の暦（土日＋祝日）で行う。Hotel.weekendDays は
// 「ホテルにとっての週末（価格上の金・土）」であり別概念なので、ここでは使わない。
// 同曜日移動平均が土日パターンを既に吸収しているため、祝日要因は
// 「祝日を含む連休」に限って効かせる（純粋な土日は base 側に任せる）。
import { JP_HOLIDAYS, JP_HOLIDAYS_LAST_YEAR } from '../../data/jpHolidays.js'

const HOLIDAY_BY_DATE: ReadonlyMap<string, string> = new Map(JP_HOLIDAYS)

export type HolidayPosition = 'eve' | 'within' | 'last' | 'none'
export type SpecialPeriod = 'gw' | 'obon' | 'nenmatsu'
export type SchoolBreak = 'spring' | 'summer' | 'winter'

export interface HolidaySignal {
  /** 祝日データの収録範囲内か（範囲外なら祝日判定は信用しない） */
  known: boolean
  isHoliday: boolean
  holidayName: string | null
  /** 翌日（チェックアウト日）が土日祝か */
  nextDayOff: boolean
  /** 翌日が祝日（土日ではなく）か。日曜夜→月曜祝日のような「曜日で説明できない」需要の主因 */
  nextDayIsHoliday: boolean
  /** 宿泊日〜翌日を含む連続休暇ブロックの長さ（休みでなければ 0） */
  blockLength: number
  /** ブロックに祝日が含まれるか（土日だけのブロックは false） */
  blockHasHoliday: boolean
  /** eve=連休前夜（当日は平日）, within=連休中（翌日も休み）, last=連休最終夜（翌日は平日）, none */
  position: HolidayPosition
  /** 飛び石の平日（前後が休み）。有休で埋まりやすく連休扱いに近づく */
  isBridgeDay: boolean
  specialPeriod: SpecialPeriod | null
  schoolBreak: SchoolBreak | null
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number): Date {
  const r = new Date(date)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}

export function getHolidayName(date: Date): string | null {
  return HOLIDAY_BY_DATE.get(toIsoDate(date)) ?? null
}

export function isHolidayDataKnown(date: Date): boolean {
  return date.getUTCFullYear() <= JP_HOLIDAYS_LAST_YEAR
}

/** 土日または祝日 */
export function isOffDay(date: Date): boolean {
  const dow = date.getUTCDay()
  return dow === 0 || dow === 6 || HOLIDAY_BY_DATE.has(toIsoDate(date))
}

/**
 * 特別期間（宿泊日ベース）。祝日の並びに関係なく毎年ほぼ固定で需要が動く期間。
 * GW: 4/28〜5/5 泊、お盆: 8/11〜8/15 泊、年末年始: 12/28〜1/3 泊
 */
export function getSpecialPeriod(date: Date): SpecialPeriod | null {
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  if ((m === 4 && d >= 28) || (m === 5 && d <= 5)) return 'gw'
  if (m === 8 && d >= 11 && d <= 15) return 'obon'
  if ((m === 12 && d >= 28) || (m === 1 && d <= 3)) return 'nenmatsu'
  return null
}

/**
 * 学校休暇（全国の公立小中の概ねの期間。都道府県差は将来ホテル設定で上書き）。
 * 春: 3/25〜4/6、夏: 7/20〜8/31、冬: 12/24〜1/7
 */
export function getSchoolBreak(date: Date): SchoolBreak | null {
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  if ((m === 3 && d >= 25) || (m === 4 && d <= 6)) return 'spring'
  if ((m === 7 && d >= 20) || m === 8) return 'summer'
  if ((m === 12 && d >= 24) || (m === 1 && d <= 7)) return 'winter'
  return null
}

/**
 * date を含む連続休暇ブロック [start, end] を返す。date が休みでなければ null
 */
function findOffBlock(date: Date): { start: Date; end: Date } | null {
  if (!isOffDay(date)) return null
  let start = date
  while (isOffDay(addUtcDays(start, -1))) start = addUtcDays(start, -1)
  let end = date
  while (isOffDay(addUtcDays(end, 1))) end = addUtcDays(end, 1)
  return { start, end }
}

function blockContainsHoliday(start: Date, end: Date): boolean {
  for (let d = start; d <= end; d = addUtcDays(d, 1)) {
    if (HOLIDAY_BY_DATE.has(toIsoDate(d))) return true
  }
  return false
}

/**
 * 宿泊日 d の祝日・連休シグナルを計算する
 */
export function computeHolidaySignal(date: Date): HolidaySignal {
  const next = addUtcDays(date, 1)
  const prev = addUtcDays(date, -1)
  const holidayName = getHolidayName(date)
  const todayOff = isOffDay(date)
  const nextOff = isOffDay(next)

  // 宿泊日の夜は「翌日が休みか」で意味が変わるため、ブロックは翌日側を優先して探す
  const block = findOffBlock(nextOff ? next : date)
  const blockLength = block ? Math.round((block.end.getTime() - block.start.getTime()) / 86_400_000) + 1 : 0
  const blockHasHoliday = block ? blockContainsHoliday(block.start, block.end) : false

  let position: HolidayPosition = 'none'
  if (nextOff && !todayOff) position = 'eve'
  else if (nextOff && todayOff) position = 'within'
  else if (todayOff && !nextOff) position = 'last'

  return {
    known: isHolidayDataKnown(date) && isHolidayDataKnown(next),
    isHoliday: holidayName != null,
    holidayName,
    nextDayOff: nextOff,
    nextDayIsHoliday: HOLIDAY_BY_DATE.has(toIsoDate(next)),
    blockLength,
    blockHasHoliday,
    position,
    isBridgeDay: !todayOff && isOffDay(prev) && nextOff,
    specialPeriod: getSpecialPeriod(date),
    schoolBreak: getSchoolBreak(date),
  }
}

/**
 * 需要側の要因キー（FactorCoefficient.factorKey）に展開する。
 * 各キーの係数（稼働率pt）は factorDefaults.ts の初期値 → 学習で上書き。
 * 土日だけのブロックは base（同曜日移動平均）に任せるため、キーを出さない。
 */
export function holidayFactorKeys(signal: HolidaySignal): string[] {
  const keys: string[] = []
  if (signal.blockHasHoliday) {
    if (signal.position === 'eve') keys.push('holiday:eve')
    if (signal.position === 'within') keys.push(signal.blockLength >= 3 ? 'holiday:within_long' : 'holiday:within')
    if (signal.position === 'last') keys.push('holiday:last')
  }
  if (signal.isBridgeDay) keys.push('holiday:bridge')
  if (signal.specialPeriod) keys.push(`special:${signal.specialPeriod}`)
  if (signal.schoolBreak) keys.push(`school:${signal.schoolBreak}`)
  return keys
}
