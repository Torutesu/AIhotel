import { describe, it, expect } from 'vitest'
import { aggregateCancellations } from './cancellationService.js'
import { aggregateBySegment, guestsBucketOf, type SegmentRow } from './segmentAnalysisService.js'
import { buildCurve, daysBetween } from './onHandService.js'
import {
  cancellationQuerySchema,
  segmentAnalysisQuerySchema,
  rankingQuerySchema,
  onHandCurveQuerySchema,
  inventoryQuerySchema,
} from '../lib/validators.js'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('aggregateCancellations', () => {
  const rows = [
    // 予約: 8/1, キャンセル: 8/3
    { bookedAt: d('2026-08-01'), cancelledAt: d('2026-08-03'), rooms: 2, roomRevenue: 40000 },
    // 予約のみ 8/1
    { bookedAt: d('2026-08-01'), cancelledAt: null, rooms: 3, roomRevenue: 60000 },
    // 予約のみ 8/2
    { bookedAt: d('2026-08-02'), cancelledAt: null, rooms: 1, roomRevenue: 15000 },
  ]

  it('日別に予約とキャンセルを別々の日付バケットへ集計する', () => {
    const buckets = aggregateCancellations(rows, 'daily', d('2026-08-01'), d('2026-08-31'))
    expect(buckets.map((b) => b.period)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])

    const aug1 = buckets[0]
    expect(aug1.bookedRooms).toBe(5) // 2 + 3
    expect(aug1.bookedCount).toBe(2)
    expect(aug1.bookedRevenue).toBe(100000)
    expect(aug1.cancelledRooms).toBe(0)

    const aug3 = buckets[2]
    expect(aug3.cancelledRooms).toBe(2)
    expect(aug3.cancelledCount).toBe(1)
    expect(aug3.cancelledRevenue).toBe(40000)
    // 予約:キャンセル差異（当日予約0 - キャンセル2）
    expect(aug3.diffRooms).toBe(-2)
  })

  it('月別集計では同月の予約・キャンセルが1バケットに入りキャンセル率が出る', () => {
    const buckets = aggregateCancellations(rows, 'monthly', d('2026-08-01'), d('2026-08-31'))
    expect(buckets).toHaveLength(1)
    const aug = buckets[0]
    expect(aug.period).toBe('2026-08')
    expect(aug.bookedRooms).toBe(6)
    expect(aug.cancelledRooms).toBe(2)
    expect(aug.cancellationRate).toBeCloseTo(0.333, 3)
    expect(aug.diffRooms).toBe(4)
  })

  it('期間外の予約日・キャンセル日を除外する', () => {
    const buckets = aggregateCancellations(rows, 'daily', d('2026-08-02'), d('2026-08-02'))
    expect(buckets).toHaveLength(1)
    expect(buckets[0].period).toBe('2026-08-02')
    expect(buckets[0].bookedRooms).toBe(1)
  })
})

describe('guestsBucketOf', () => {
  it('1名/2名/3名以上に区分する（F-DAILY-03と同じ区分）', () => {
    expect(guestsBucketOf(1)).toBe('1名')
    expect(guestsBucketOf(2)).toBe('2名')
    expect(guestsBucketOf(3)).toBe('3名以上')
    expect(guestsBucketOf(7)).toBe('3名以上')
    expect(guestsBucketOf(null)).toBe('不明')
  })
})

describe('aggregateBySegment', () => {
  const rows: SegmentRow[] = [
    {
      roomTypeCode: 'DMN',
      marketCode: 'IFJ',
      regionCode: '12TK',
      agentCode: 'RAK',
      rateTypeCode: 'OTA',
      individualGroupType: 'I',
      guestsBucket: '2名',
      rooms: 10,
      guests: 20,
      roomRevenue: 200000,
    },
    {
      roomTypeCode: 'TSN',
      marketCode: 'GAJ',
      regionCode: '29OS',
      agentCode: 'JTB',
      rateTypeCode: 'OWN',
      individualGroupType: 'G',
      guestsBucket: '3名以上',
      rooms: 30,
      guests: 90,
      roomRevenue: 450000,
    },
    {
      roomTypeCode: 'DMN',
      marketCode: 'IFJ',
      regionCode: '12TK',
      agentCode: 'RAK',
      rateTypeCode: 'OTA',
      individualGroupType: 'I',
      guestsBucket: '2名',
      rooms: 5,
      guests: 10,
      roomRevenue: 100000,
    },
  ]

  it('マーケット軸で室数降順に集計しADR・客単価・構成比を出す', () => {
    const result = aggregateBySegment(rows, 'market')
    expect(result.map((b) => b.code)).toEqual(['GAJ', 'IFJ']) // 30室 > 15室

    const ifj = result.find((b) => b.code === 'IFJ')!
    expect(ifj.rooms).toBe(15)
    expect(ifj.guests).toBe(30)
    expect(ifj.revenue).toBe(300000)
    expect(ifj.adr).toBe(20000) // 300000 / 15
    expect(ifj.guestUnitPrice).toBe(10000) // 300000 / 30
    expect(ifj.roomShare).toBeCloseTo(0.333, 3) // 15 / 45
  })

  it('部屋タイプ軸では同一コードがまとめられる', () => {
    const result = aggregateBySegment(rows, 'roomType')
    expect(result.find((b) => b.code === 'DMN')!.rooms).toBe(15)
    expect(result.find((b) => b.code === 'TSN')!.rooms).toBe(30)
  })

  it('利用人数軸で集計できる（構成比・客単価。稼働率は出さない — F-ANA-01）', () => {
    const result = aggregateBySegment(rows, 'guests')
    expect(result.map((b) => b.code)).toEqual(['3名以上', '2名'])
    expect(result[0]).not.toHaveProperty('occupancy')
  })

  it('コードが無い明細は「不明」にまとめる', () => {
    const result = aggregateBySegment(
      [{ ...rows[0], agentCode: null }],
      'agent'
    )
    expect(result[0].code).toBe('不明')
  })
})

describe('daysBetween / buildCurve', () => {
  it('daysBetweenはUTC日単位の差を返す', () => {
    expect(daysBetween(d('2026-08-01'), d('2026-08-11'))).toBe(10)
    expect(daysBetween(d('2026-08-11'), d('2026-08-01'))).toBe(-10)
  })

  it('リードタイムをstep刻みのバケットへ畳み込み360日前→0日前で返す', () => {
    const snapshots = [
      { stayDate: d('2026-08-31'), capturedDate: d('2026-08-01'), rooms: 100, revenue: 1600000 }, // 30日前
      { stayDate: d('2026-08-31'), capturedDate: d('2026-08-21'), rooms: 150, revenue: 2550000 }, // 10日前
      { stayDate: d('2026-08-31'), capturedDate: d('2026-08-31'), rooms: 180, revenue: 3240000 }, // 0日前
    ]
    const points = buildCurve(snapshots, 10, 360, 200)
    expect(points.map((p) => p.daysBefore)).toEqual([30, 10, 0])
    expect(points[0].rooms).toBe(100)
    expect(points[2].rooms).toBe(180)
    expect(points[2].adr).toBe(18000) // 3240000 / 180
    expect(points[2].occupancy).toBe(0.9) // 180 / 200
  })

  it('複数宿泊日を同じバケットで合算する（月間カーブ）', () => {
    const snapshots = [
      { stayDate: d('2026-08-10'), capturedDate: d('2026-07-31'), rooms: 50, revenue: 800000 },
      { stayDate: d('2026-08-11'), capturedDate: d('2026-08-01'), rooms: 70, revenue: 1120000 },
    ]
    const points = buildCurve(snapshots, 10, 360, null)
    expect(points).toHaveLength(1)
    expect(points[0].daysBefore).toBe(10)
    expect(points[0].rooms).toBe(120)
    expect(points[0].occupancy).toBeNull() // 総室数不明時はnull
  })

  it('同一宿泊日・同一バケットに複数断面がある場合は宿泊日に近い方を採用する', () => {
    const snapshots = [
      { stayDate: d('2026-08-31'), capturedDate: d('2026-08-22'), rooms: 140, revenue: 0 }, // 9日前
      { stayDate: d('2026-08-31'), capturedDate: d('2026-08-25'), rooms: 160, revenue: 0 }, // 6日前
    ]
    const points = buildCurve(snapshots, 10, 360, null)
    expect(points).toHaveLength(1)
    expect(points[0].rooms).toBe(160)
  })

  it('maxDaysBeforeを超えるリードタイムと未来断面を除外する', () => {
    const snapshots = [
      { stayDate: d('2026-08-31'), capturedDate: d('2024-08-31'), rooms: 5, revenue: 0 }, // 730日前
      { stayDate: d('2026-08-31'), capturedDate: d('2026-09-05'), rooms: 999, revenue: 0 }, // 負のリード
      { stayDate: d('2026-08-31'), capturedDate: d('2026-08-31'), rooms: 180, revenue: 0 },
    ]
    const points = buildCurve(snapshots, 10, 360, null)
    expect(points).toHaveLength(1)
    expect(points[0].rooms).toBe(180)
  })
})

describe('4B クエリバリデータ', () => {
  it('キャンセル分析のクエリを受け入れ既定値を補う', () => {
    const r = cancellationQuerySchema.safeParse({
      hotelId: 'demo-hotel-001',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.granularity).toBe('daily')
      expect(r.data.compareLastYear).toBe(false)
    }
  })

  it('開始日が終了日より後のキャンセル分析クエリを拒否する', () => {
    const r = cancellationQuerySchema.safeParse({
      hotelId: 'demo-hotel-001',
      startDate: '2026-08-31',
      endDate: '2026-08-01',
    })
    expect(r.success).toBe(false)
  })

  it('セグメント分析の上位表示件数は既定10（機能リストの要確認事項のためパラメータ化）', () => {
    const r = segmentAnalysisQuerySchema.safeParse({
      hotelId: 'demo-hotel-001',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      axis: 'market',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.limit).toBe(10)
  })

  it('未知の集計軸を拒否する', () => {
    const r = segmentAnalysisQuerySchema.safeParse({
      hotelId: 'demo-hotel-001',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      axis: 'unknown',
    })
    expect(r.success).toBe(false)
  })

  it('上位下位分析の指標は adr / occupancy のみ', () => {
    expect(
      rankingQuerySchema.safeParse({
        hotelId: 'demo-hotel-001',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        metric: 'revpar',
      }).success
    ).toBe(false)
  })

  it('オンハンドカーブは stayDate か year+month のどちらかが必須', () => {
    expect(
      onHandCurveQuerySchema.safeParse({ hotelId: 'demo-hotel-001' }).success
    ).toBe(false)
    const monthly = onHandCurveQuerySchema.safeParse({
      hotelId: 'demo-hotel-001',
      year: 2026,
      month: 8,
    })
    expect(monthly.success).toBe(true)
    if (monthly.success) {
      // 進捗管理表と同じ10日刻み・360日前が既定
      expect(monthly.data.step).toBe(10)
      expect(monthly.data.maxDaysBefore).toBe(360)
    }
  })

  it('残室ビューは既定で前回断面と比較する', () => {
    const r = inventoryQuerySchema.safeParse({
      hotelId: 'demo-hotel-001',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.comparePrevious).toBe(true)
  })
})
