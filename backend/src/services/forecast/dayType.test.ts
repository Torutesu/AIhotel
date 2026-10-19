import { describe, it, expect } from 'vitest'
import { buildDayTypeTimeline, classifyDayType, gradePace } from './dayType.js'

// 日のタイプ（英字 = 着地見込みの需要、数字 = 前年同曜日と比べたペース）

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('gradePace', () => {
  it('±5%未満を前年並み（3）にし、境目ちょうどは外側に入れる', () => {
    expect(gradePace(1.25)).toBe(1)
    expect(gradePace(1.2)).toBe(1)
    expect(gradePace(1.19)).toBe(2)
    expect(gradePace(1.05)).toBe(2)
    expect(gradePace(1.04)).toBe(3)
    expect(gradePace(0.96)).toBe(3)
    expect(gradePace(0.95)).toBe(4)
    expect(gradePace(0.81)).toBe(4)
    expect(gradePace(0.8)).toBe(5)
  })
})

describe('classifyDayType', () => {
  const base = { totalRooms: 100 }

  it('今の予約＋前年の残りの伸びで着地を見込み、前年とのペースを数字にする', () => {
    // 今年 残30日で60室、前年 同時点50室・最終80室 → 着地 60+30=90室（B: 90%はA未満）、ペース 1.2 → 1
    expect(classifyDayType({ ...base, otbRooms: 60, lastYearOtbRooms: 50, lastYearFinalRooms: 80 })).toEqual({
      dayType: 'B1',
      demandGrade: 'B',
      paceGrade: 1,
      expectedOccupancy: 0.9,
      paceRatio: 1.2,
    })
    // 今年 40室、前年 同時点50室・最終70室 → 着地 60室（D）、ペース 0.8 → 5
    expect(classifyDayType({ ...base, otbRooms: 40, lastYearOtbRooms: 50, lastYearFinalRooms: 70 }).dayType).toBe('D5')
  })

  it('着地見込みは客室数で頭打ちにする', () => {
    const r = classifyDayType({ ...base, otbRooms: 90, lastYearOtbRooms: 40, lastYearFinalRooms: 95 })
    expect(r.expectedOccupancy).toBe(1)
    expect(r.dayType).toBe('A1')
  })

  it('前年と比べられなければ AI の予測で英字だけを出す（予約済みは下回らない）', () => {
    expect(classifyDayType({ ...base, otbRooms: 20, lastYearOtbRooms: null, lastYearFinalRooms: null, fallbackOccupancy: 0.7 })).toMatchObject({
      dayType: 'C',
      paceGrade: null,
      paceRatio: null,
    })
    expect(classifyDayType({ ...base, otbRooms: 85, lastYearOtbRooms: null, lastYearFinalRooms: null, fallbackOccupancy: 0.6 }).dayType).toBe('B')
  })

  it('前年の予約が少なすぎるときはペースを出さない', () => {
    const r = classifyDayType({ ...base, otbRooms: 10, lastYearOtbRooms: 2, lastYearFinalRooms: 60 })
    expect(r.paceGrade).toBeNull()
    expect(r.dayType).toBe('C') // 着地は 10 + (60 − 2) = 68室
  })

  it('何も分からなければ null', () => {
    expect(classifyDayType({ ...base, otbRooms: null, lastYearOtbRooms: null, lastYearFinalRooms: null }).dayType).toBeNull()
    expect(classifyDayType({ totalRooms: 0, otbRooms: 5, lastYearOtbRooms: 5, lastYearFinalRooms: 5 }).dayType).toBeNull()
  })
})

describe('buildDayTypeTimeline', () => {
  const totalRooms = 100
  // 前年同曜日: 90日前20室 → 30日前50室 → 7日前70室 → 最終80室
  const lastYearPoints = [
    { stayDate: d('2025-11-21'), daysBefore: 90, roomsBooked: 20 },
    { stayDate: d('2025-11-21'), daysBefore: 30, roomsBooked: 50 },
    { stayDate: d('2025-11-21'), daysBefore: 7, roomsBooked: 70 },
  ]
  const stayDate = d('2026-11-20')
  const points = [
    { stayDate, daysBefore: 90, roomsBooked: 24 },
    { stayDate, daysBefore: 30, roomsBooked: 45 },
    { stayDate, daysBefore: 10, roomsBooked: 52 },
  ]

  it('今より前の残日数だけを履歴にし、今のタイプは直近の予約で出す', () => {
    const t = buildDayTypeTimeline({
      stayDate,
      today: d('2026-11-10'), // 残10日
      totalRooms,
      points,
      lastYearPoints,
      lastYearFinalRooms: 80,
      actualSoldRooms: null,
      predictedOccupancy: 0.7,
    })
    expect(t.history.map((h) => h.daysBefore)).toEqual([90, 60, 30, 14])
    // 90日前: 24室 vs 20室（1.2 → 1）、着地 24+60=84 → B
    expect(t.history[0]).toEqual({ daysBefore: 90, dayType: 'B1', otbRooms: 24, paceRatio: 1.2 })
    // 60日前・14日前は記録が無い（前後3日以内に予約の記録が無い）
    expect(t.history[1].dayType).toBeNull()
    expect(t.history[3].dayType).toBeNull()
    // 30日前: 45 vs 50（0.9 → 4）、着地 45+30=75 → C
    expect(t.history[2].dayType).toBe('C4')
    // 今（残10日）: 前年の残10日に近い記録は無い → AI の予測（70% → C）で英字だけ
    expect(t.current.dayType).toBe('C')
  })

  it('宿泊日を過ぎた日は結果（販売室数）で判定し、残日数0の前年は前年の結果と比べる', () => {
    const t = buildDayTypeTimeline({
      stayDate,
      today: d('2026-11-25'),
      totalRooms,
      points,
      lastYearPoints,
      lastYearFinalRooms: 80,
      actualSoldRooms: 92,
      predictedOccupancy: 0.7,
    })
    expect(t.history.map((h) => h.daysBefore)).toEqual([90, 60, 30, 14, 7, 3, 1, 0])
    expect(t.history.at(-1)).toEqual({ daysBefore: 0, dayType: 'A2', otbRooms: 92, paceRatio: 1.15 })
    // 92 vs 80 = 1.15 → 2。着地は結果そのもの（92%）→ A
    expect(t.current).toMatchObject({ dayType: 'A2', expectedOccupancy: 0.92 })
  })

  it('当日でも結果（販売室数）が入っていれば結果で判定する', () => {
    const today = { stayDate, today: stayDate, totalRooms, lastYearPoints, lastYearFinalRooms: 80, predictedOccupancy: 0.7 }
    const withToday = [...points, { stayDate, daysBefore: 0, roomsBooked: 60 }]
    expect(buildDayTypeTimeline({ ...today, points: withToday, actualSoldRooms: 92 }).current).toMatchObject({ dayType: 'A2', expectedOccupancy: 0.92 })
    // 結果がまだ無ければ今日の取り込み（60室）で見る
    expect(buildDayTypeTimeline({ ...today, points: withToday, actualSoldRooms: null }).current.expectedOccupancy).toBe(0.6)
  })
})

