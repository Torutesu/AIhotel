import { describe, it, expect } from 'vitest'
import {
  buildDayTypes,
  buildDayTypeTimeline,
  classifyDay,
  modelForOccupancy,
  modelForQuadrant,
  quadrantOf,
  shareAtLead,
  weightsForModel,
  type DayTypeHistoryDay,
  type DayTypeProfile,
} from './dayType.js'

// 日のタイプ（日のモデル — 2026-10、D-13 で着地の4象限に置き換え）。平日A型・週末A型・特日A型…のように、
// 区分ごとに過去の結果（最終の稼働×ADR）から型を作り、先の日は今の予約の入り方に近い型にする（予約が進むと型が変わる）

const DAY = 86_400_000
const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** 最終 finalRooms 室の日の、残日数ごとの予約積上（share は最終に対する割合） */
function curve(stayDate: Date, finalRooms: number, shares: Record<number, number>) {
  return Object.entries(shares).map(([lead, share]) => ({ stayDate, daysBefore: Number(lead), roomsBooked: Math.round(finalRooms * share) }))
}

/** 稼働 occupancy の過去の平日（客室100室）を n 日 */
function days(
  n: number,
  occupancy: number,
  category: DayTypeHistoryDay['category'] = 'weekday',
  start = '2025-06-01',
  adr: number = occupancy > 0.8 ? 22000 : 15000
): DayTypeHistoryDay[] {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(d(start).getTime() + i * DAY)
    const finalRooms = Math.round(occupancy * 100)
    return {
      date,
      category,
      occupancy,
      adr,
      finalRooms,
      points: curve(date, finalRooms, { 90: 0.2, 30: 0.6, 7: 0.9, 0: 1 }),
    }
  })
}

describe('quadrantOf / modelForQuadrant', () => {
  it('区分の中央値で4象限に分ける（境目ちょうどは高い側）', () => {
    expect(quadrantOf(0.9, 20000, 0.8, 18000)).toBe('A')
    expect(quadrantOf(0.8, 15000, 0.8, 18000)).toBe('B')
    expect(quadrantOf(0.5, 18000, 0.8, 18000)).toBe('C')
    expect(quadrantOf(0.5, 12000, 0.8, 18000)).toBe('D')
    // ADR が分からなければ高単価の側
    expect(quadrantOf(0.5, null, 0.8, 18000)).toBe('C')
  })

  it('高稼働は単価優先・低稼働は稼働優先。ホテル全体が弱い・強いときはバランス', () => {
    expect(modelForQuadrant('A', 0.9)).toBe('adr')
    expect(modelForQuadrant('B', 0.6)).toBe('balanced')
    expect(modelForQuadrant('D', 0.4)).toBe('occupancy')
    expect(modelForQuadrant('C', 0.88)).toBe('balanced')
  })
})

describe('buildDayTypes', () => {
  // 平日: 高稼働・高単価 10日、高稼働・低単価 9日、低稼働・高単価 9日、低稼働・低単価 10日。週末は 12日で1つ
  const history = [
    ...days(10, 0.95, 'weekday', '2025-06-01', 24000),
    ...days(9, 0.92, 'weekday', '2025-07-01', 14000),
    ...days(9, 0.55, 'weekday', '2025-08-01', 23000),
    ...days(10, 0.5, 'weekday', '2025-09-01', 13000),
    ...days(12, 0.88, 'weekend'),
  ]
  const types = buildDayTypes(history)

  it('区分ごとに着地の4象限（A 高稼働・高単価〜D 低稼働・低単価）で名付け、優先モデルを割り当てる', () => {
    expect(types.map((t) => t.name)).toEqual(['平日A型', '平日B型', '平日C型', '平日D型', '週末A型'])
    const [a, b, c, dd] = types
    expect(a).toMatchObject({ id: 'weekday-A', days: 10, avgOccupancy: 0.95, model: 'adr', avgAdr: 24000, quadrantLabel: '高稼働・高単価' })
    expect(b).toMatchObject({ days: 9, quadrantLabel: '高稼働・低単価', model: 'adr' })
    expect(c).toMatchObject({ days: 9, quadrantLabel: '低稼働・高単価', model: 'occupancy' })
    expect(dd).toMatchObject({ days: 10, quadrantLabel: '低稼働・低単価', model: 'occupancy' })
    // 週末はばらつきが無いので1つ（平均の稼働で優先モデルを決める）
    expect(types[4]).toMatchObject({ quadrantLabel: '全体', model: 'adr', days: 12 })
  })

  it('小さい象限は稼働の同じ側にまとめ、日はどれか1つの型にだけ入る', () => {
    const tied = [...days(11, 0.6), ...days(8, 1, 'weekday', '2025-08-01', 22000), ...days(3, 1, 'weekday', '2025-09-01', 15000)]
    const built = buildDayTypes(tied)
    expect(built.reduce((a, t) => a + t.days, 0)).toBe(tied.length)
    expect(built.find((t) => t.quadrantLabel === '高稼働')).toMatchObject({ days: 11, quadrant: 'A' })
  })

  it('ADR の記録が無い区分は稼働だけで A（高稼働）・D（低稼働）に分ける', () => {
    const noAdr = [...days(10, 0.9), ...days(10, 0.5)].map((x) => ({ ...x, adr: null }))
    expect(buildDayTypes(noAdr).map((t) => [t.name, t.quadrantLabel])).toEqual([
      ['平日A型', '高稼働'],
      ['平日D型', '低稼働'],
    ])
  })

  it('型ごとの典型カーブ（最終に対する予約の割合の中央値）を持つ', () => {
    expect(types[0].curveShare).toEqual(
      expect.arrayContaining([
        { daysBefore: 90, share: expect.closeTo(0.2, 1) },
        { daysBefore: 30, share: expect.closeTo(0.6, 1) },
        { daysBefore: 0, share: 1 },
      ])
    )
  })

  it('象限に分けない区分は稼働に応じて優先モデルを決める（85%以上 = 単価優先、65%以下 = 稼働優先）', () => {
    expect(modelForOccupancy(0.9)).toBe('adr')
    expect(modelForOccupancy(0.75)).toBe('balanced')
    expect(modelForOccupancy(0.6)).toBe('occupancy')
  })
})

const profile = (over: Partial<DayTypeProfile>): DayTypeProfile => ({
  id: 'weekday-A',
  name: '平日A型',
  category: 'weekday',
  letter: 'A',
  quadrant: 'A',
  quadrantLabel: '高稼働・高単価',
  occupancyThreshold: 0.75,
  adrThreshold: 18000,
  days: 10,
  avgOccupancy: 0.9,
  minOccupancy: 0.85,
  maxOccupancy: 0.95,
  avgAdr: 20000,
  model: 'adr',
  curveShare: [
    { daysBefore: 90, share: 0.2 },
    { daysBefore: 30, share: 0.6 },
    { daysBefore: 0, share: 1 },
  ],
  ...over,
})
const A = profile({})
const B = profile({ id: 'weekday-D', name: '平日D型', letter: 'D', quadrant: 'D', avgOccupancy: 0.6, avgAdr: 14000, model: 'occupancy' })
const AB = profile({ id: 'weekday-B', name: '平日B型', letter: 'B', quadrant: 'B', avgOccupancy: 0.88, avgAdr: 15000 })

describe('shareAtLead / classifyDay', () => {
  it('典型カーブの間の残日数は直線で補い、範囲外は null', () => {
    expect(shareAtLead(A, 60)).toBe(0.4)
    expect(shareAtLead(A, 200)).toBeNull()
  })

  it('予約の記録があれば、その残日数の典型の予約室数に近い型にする', () => {
    // 30日前の典型: A = 0.6 × 90室 = 54室、B = 0.6 × 60室 = 36室
    expect(classifyDay({ types: [A, B], lead: 30, totalRooms: 100, otbRooms: 50 })?.name).toBe('平日A型')
    expect(classifyDay({ types: [A, B], lead: 30, totalRooms: 100, otbRooms: 38 })?.name).toBe('平日D型')
  })

  it('稼働の側が決まったら、予測 ADR で単価の側を決める', () => {
    expect(classifyDay({ types: [A, AB, B], lead: 30, totalRooms: 100, otbRooms: 53, predictedAdr: 16000 })?.name).toBe('平日B型')
    expect(classifyDay({ types: [A, AB, B], lead: 30, totalRooms: 100, otbRooms: 53, predictedAdr: 21000 })?.name).toBe('平日A型')
    expect(classifyDay({ types: [A, AB, B], lead: 0, totalRooms: 100, otbRooms: 90, finalOccupancy: 0.9, finalAdr: 15000 })?.name).toBe('平日B型')
  })

  it('結果の出た日は最終の稼働率、記録の無い日は予測稼働率で決める', () => {
    expect(classifyDay({ types: [A, B], lead: 0, totalRooms: 100, otbRooms: 88, finalOccupancy: 0.88 })?.name).toBe('平日A型')
    expect(classifyDay({ types: [A, B], lead: 200, totalRooms: 100, otbRooms: null, predictedOccupancy: 0.65 })?.name).toBe('平日D型')
  })

  it('型が無い（過去の実績が足りない）日は null', () => {
    expect(classifyDay({ types: [], lead: 10, totalRooms: 100, otbRooms: 10 })).toBeNull()
  })
})

describe('buildDayTypeTimeline', () => {
  const stayDate = d('2026-11-20')
  const today = d('2026-10-21') // 30日前

  it('予約の入り方で型が変わり、推移に残る（90日前は B の入り方 → 今は A の入り方）', () => {
    const points = [
      { stayDate, daysBefore: 90, roomsBooked: 12 }, // B の典型 12室・A の典型 18室 → B
      { stayDate, daysBefore: 60, roomsBooked: 32 }, // A の典型 36室・B 24室 → A
      { stayDate, daysBefore: 30, roomsBooked: 55 },
    ]
    const t = buildDayTypeTimeline({ stayDate, today, totalRooms: 100, types: [A, B], points, actualSoldRooms: null, predictedOccupancy: 0.8 })
    expect(t.history).toEqual([
      { daysBefore: 90, dayType: '平日D型', otbRooms: 12 },
      { daysBefore: 60, dayType: '平日A型', otbRooms: 32 },
    ])
    expect(t.current).toEqual({ id: 'weekday-A', name: '平日A型', model: 'adr', typicalOccupancy: 0.9 })
  })

  it('結果の出た日は結果で決め、推移の「当日」も結果', () => {
    const past = d('2026-10-10')
    const points = [{ stayDate: past, daysBefore: 30, roomsBooked: 40 }]
    const t = buildDayTypeTimeline({ stayDate: past, today, totalRooms: 100, types: [A, B], points, actualSoldRooms: 62, predictedOccupancy: 0.9 })
    expect(t.current?.name).toBe('平日D型')
    expect(t.history.at(-1)).toEqual({ daysBefore: 0, dayType: '平日D型', otbRooms: 62 })
  })
})

describe('weightsForModel', () => {
  const base = { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 }
  it('稼働優先は単価の重みから、単価優先は稼働の重みから 20 ポイント移す（合計は 100 のまま）', () => {
    expect(weightsForModel(base, 'occupancy')).toEqual({ weightOccupancy: 60, weightAdr: 20, weightCompetitor: 20 })
    expect(weightsForModel(base, 'adr')).toEqual({ weightOccupancy: 20, weightAdr: 60, weightCompetitor: 20 })
    expect(weightsForModel(base, 'balanced')).toEqual(base)
    // 移せる重みが無ければ動かさない
    expect(weightsForModel({ weightOccupancy: 100, weightAdr: 0, weightCompetitor: 0 }, 'occupancy')).toEqual({
      weightOccupancy: 100,
      weightAdr: 0,
      weightCompetitor: 0,
    })
  })
})
