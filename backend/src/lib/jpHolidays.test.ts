import { describe, expect, it } from 'vitest'
import { holidayName, holidayRunOf, isDayOff, parseCabinetOfficeHolidayCsv, registerHolidays, holidaysKnownThrough } from './jpHolidays.js'
import { specialDayName } from '../services/forecast/specialDays.js'

const d = (s: string) => new Date(`${s}T00:00:00Z`)

describe('jpHolidays（内閣府の祝日 — D-13）', () => {
  it('移動祝日・振替休日を含む', () => {
    expect(holidayName(d('2026-01-12'))).toBe('成人の日')
    expect(holidayName(d('2026-07-20'))).toBe('海の日')
    expect(holidayName(d('2026-05-06'))).toBe('休日') // 振替休日
    expect(holidayName(d('2026-01-13'))).toBeNull()
  })

  it('休日（土日・祝日）と連休の並び', () => {
    expect(isDayOff(d('2026-11-14'))).toBe(true) // 土
    expect(isDayOff(d('2026-11-16'))).toBe(false)
    // 2026-11-21(土)〜23(月・勤労感謝の日)の3連休。金曜の泊は3連休の前夜
    expect(holidayRunOf(d('2026-11-20'))).toEqual({ beforeDayOff: true, daysOffAhead: 3, positionInRun: 0, runLength: 0 })
    // 中日（日曜の泊。翌日も休み）
    expect(holidayRunOf(d('2026-11-22'))).toEqual({ beforeDayOff: true, daysOffAhead: 1, positionInRun: 2, runLength: 3 })
    // 最終日（月曜の泊。翌日は平日）
    expect(holidayRunOf(d('2026-11-23'))).toEqual({ beforeDayOff: false, daysOffAhead: 0, positionInRun: 3, runLength: 3 })
  })

  it('祝日の前の泊は特日（祝前日）', () => {
    expect(specialDayName(d('2026-07-19'))).toBe('祝前日') // 日曜。翌日が海の日
    expect(specialDayName(d('2026-07-20'))).toBe('海の日')
    expect(specialDayName(d('2026-07-21'))).toBeNull()
  })

  it('内閣府の CSV を読み、同梱分より新しい年だけを足す', () => {
    const rows = parseCabinetOfficeHolidayCsv('国民の祝日・休日月日,国民の祝日・休日名称\r\n2026/1/1,元日\r\n2099/1/1,元日\r\n2099/1/12,成人の日\r\nbad line')
    expect(rows).toHaveLength(3)
    // 一覧に無い年は日付の決まった祝日だけ
    expect(holidayName(d('2099-01-12'))).toBeNull()
    expect(holidayName(d('2099-01-01'))).toBe('元日')
    expect(registerHolidays(rows)).toBe(2)
    expect(holidaysKnownThrough()).toBe(2099)
    expect(holidayName(d('2099-01-12'))).toBe('成人の日')
  })
})

describe('travelSeasonsOf（旅行の時間軸 — 先方の資料 a. 特日）', async () => {
  const { travelSeasonsOf } = await import('./travelSeasons.js')
  it('年末年始・正月明け・受験・春節・春休み・GW・夏休み・お盆・シルバーウィーク', () => {
    expect(travelSeasonsOf(d('2026-12-27'))).toEqual(['yearEnd'])
    expect(travelSeasonsOf(d('2027-01-05'))).toEqual(['yearEnd', 'postNewYear'])
    expect(travelSeasonsOf(d('2027-01-20'))).toEqual(['postNewYear', 'entranceExam'])
    expect(travelSeasonsOf(d('2026-02-17'))).toEqual(['entranceExam', 'lunarNewYear'])
    expect(travelSeasonsOf(d('2026-03-20'))).toEqual(['springBreak'])
    expect(travelSeasonsOf(d('2026-04-28'))).toEqual(['goldenWeek'])
    expect(travelSeasonsOf(d('2026-07-20'))).toEqual(['summerBreak']) // 海の日から
    expect(travelSeasonsOf(d('2026-08-11'))).toEqual(['summerBreak', 'obon'])
    // 2026 は敬老の日 9/21・国民の休日 9/22・秋分の日 9/23 で 9/19〜9/23 の5連休
    expect(travelSeasonsOf(d('2026-09-19'))).toEqual(['silverWeek'])
    expect(travelSeasonsOf(d('2026-09-23'))).toEqual(['silverWeek'])
    expect(travelSeasonsOf(d('2026-09-24'))).toEqual([])
  })
  it('特日の範囲（年末年始 12/27〜1/5、GW 4/28〜5/6、お盆は山の日〜8/16）', () => {
    expect(specialDayName(d('2026-12-27'))).toBe('年末年始')
    expect(specialDayName(d('2027-01-05'))).toBe('年末年始')
    expect(specialDayName(d('2026-05-06'))).toBe('休日') // 振替休日（祝日を先に返す）
    expect(specialDayName(d('2026-04-28'))).toBe('GW')
    expect(specialDayName(d('2026-08-14'))).toBe('お盆')
  })
})
