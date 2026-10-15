import { describe, it, expect } from 'vitest'
import { applyPace, isInRanges, lastYearSameWeekday, leadDaysBetween, otbAtLead, paceWeight } from './pace.js'

// ブッキングペースと特殊日（D-11）

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('applyPace', () => {
  const base = { totalRooms: 100 }

  it('前年同曜日より予約が速ければ予測を上げ、遅ければ下げる。残日数が短いほど強く効く', () => {
    // 前年は残30日で40室、最終80室。今年は残30日で60室（1.5倍）→ ペースから見た着地は 120室 → 上限1.0
    const fast = applyPace(0.7, { ...base, leadDays: 30, otbRooms: 60, lastYearOtbRooms: 40, lastYearFinalRooms: 80 })
    expect(fast.ratio).toBe(1.5)
    expect(fast.paceOccupancy).toBe(1)
    expect(fast.predicted).toBe(0.85) // 0.7×0.5 + 1.0×0.5
    expect(fast.impact).toBe(0.15)

    // 今年は残30日で30室（0.75倍）→ ペースから見た着地 60室
    const slow = applyPace(0.7, { ...base, leadDays: 30, otbRooms: 30, lastYearOtbRooms: 40, lastYearFinalRooms: 80 })
    expect(slow.ratio).toBe(0.75)
    expect(slow.predicted).toBe(0.65)

    // 同じペースでも残100日なら効きは弱い（0.2）
    const far = applyPace(0.7, { ...base, leadDays: 100, otbRooms: 30, lastYearOtbRooms: 40, lastYearFinalRooms: 80 })
    expect(far.predicted).toBe(0.68)
  })

  it('予約済みの室数を下限にする（前年と比べられなくても）', () => {
    const r = applyPace(0.5, { ...base, leadDays: 200, otbRooms: 72, lastYearOtbRooms: null, lastYearFinalRooms: null })
    expect(r).toMatchObject({ predicted: 0.72, otbFloorApplied: true, ratio: null })
  })

  it('前年の予約が少なすぎる・記録が無いときは比べない', () => {
    expect(applyPace(0.6, { ...base, leadDays: 10, otbRooms: 10, lastYearOtbRooms: 2, lastYearFinalRooms: 80 })).toMatchObject({
      predicted: 0.6,
      ratio: null,
    })
    expect(applyPace(0.6, { ...base, leadDays: 10, otbRooms: null, lastYearOtbRooms: 40, lastYearFinalRooms: 80 })).toMatchObject({
      predicted: 0.6,
      impact: 0,
    })
  })

  it('ペース比は 0.5〜1.5 に丸める', () => {
    const r = applyPace(0.5, { ...base, leadDays: 10, otbRooms: 5, lastYearOtbRooms: 50, lastYearFinalRooms: 80 })
    expect(r.ratio).toBe(0.5)
  })
})

describe('otbAtLead / 日付', () => {
  const points = [
    { stayDate: d('2026-12-01'), daysBefore: 40, roomsBooked: 20 },
    { stayDate: d('2026-12-01'), daysBefore: 31, roomsBooked: 30 },
    { stayDate: d('2026-12-01'), daysBefore: 10, roomsBooked: 50 },
  ]
  it('残日数以上で最も近い記録を使い、離れすぎていれば null', () => {
    expect(otbAtLead(points, 30)).toBe(30)
    expect(otbAtLead(points, 31)).toBe(30)
    expect(otbAtLead(points, 25)).toBeNull() // 31日前の記録は6日離れている
    expect(otbAtLead(points, 10)).toBe(50)
  })

  it('前年同曜日は364日前（曜日が揃う）、残日数は日付の差', () => {
    const date = d('2026-12-04')
    expect(lastYearSameWeekday(date).toISOString().slice(0, 10)).toBe('2025-12-05')
    expect(lastYearSameWeekday(date).getUTCDay()).toBe(date.getUTCDay())
    expect(leadDaysBetween(d('2026-10-15'), date)).toBe(50)
    expect(paceWeight(0)).toBe(0.6)
    expect(paceWeight(121)).toBe(0)
  })

  it('特殊日の判定', () => {
    const ranges = [{ startDate: d('2025-12-29'), endDate: d('2026-01-03') }]
    expect(isInRanges(d('2026-01-01'), ranges)).toBe(true)
    expect(isInRanges(d('2026-01-04'), ranges)).toBe(false)
  })
})
