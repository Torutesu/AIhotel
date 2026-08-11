import { describe, it, expect } from 'vitest'
import { expandStayNights, aggregateOnHand, toUtcDate } from './ingestService.js'
import {
  ingestNightsSchema,
  ingestReservationsSchema,
  ingestInventorySchema,
  upsertSegmentsSchema,
  type IngestReservationRow,
} from '../lib/validators.js'

// HG月次データ（CSV202501HG.xlsx）の代表行。
// 列: 棟コード/計上日/料金タイプ/部屋タイプ/室数/男女子人数/室料NET/サービス/
//     パッケージコード/個人団体区分/エージェントコード/地域コード/IN/OUT/デイユース
const HG_ACTUAL_ROW = {
  stayDate: '2025-01-01',
  buildingCode: 'MAIN',
  rateTypeCode: 'DMN',
  roomTypeCode: 'DMN',
  rooms: 1,
  guests: 2,
  guestsDetail: { male: 2, female: 0, child: 0 },
  roomRevenue: 27456,
  serviceFee: 2744,
  packageCode: 'RDA7D',
  individualGroupType: 'I',
  agentCode: 'DAI',
  regionCode: 'GBR',
  checkIn: '2024-12-21',
  checkOut: '2025-01-02',
  isDayUse: false,
}

describe('ingestNightsSchema', () => {
  it('HG実データの代表行を受け入れる', () => {
    const result = ingestNightsSchema.safeParse({
      hotelId: 'demo-hotel-001',
      rows: [HG_ACTUAL_ROW],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.rows[0].stayDate).toBeInstanceOf(Date)
      expect(result.data.rows[0].roomRevenue).toBe(27456)
    }
  })

  it('部屋タイプコードが無い行を拒否する', () => {
    const { roomTypeCode: _omit, ...row } = HG_ACTUAL_ROW
    const result = ingestNightsSchema.safeParse({
      hotelId: 'demo-hotel-001',
      rows: [row],
    })
    expect(result.success).toBe(false)
  })

  it('空のrowsを拒否する', () => {
    const result = ingestNightsSchema.safeParse({ hotelId: 'demo-hotel-001', rows: [] })
    expect(result.success).toBe(false)
  })
})

describe('ingestReservationsSchema', () => {
  const validReservation = {
    bookedAt: '2025-06-01',
    checkIn: '2025-08-15',
    checkOut: '2025-08-17',
    roomTypeCode: 'TSN',
    rooms: 2,
    guests: 4,
    roomRevenue: 60000,
    marketCode: 'IFJ',
    isGroup: false,
  }

  it('有効なオンハンド予約を受け入れる', () => {
    const result = ingestReservationsSchema.safeParse({
      hotelId: 'demo-hotel-001',
      capturedDate: '2025-08-11',
      rows: [validReservation],
    })
    expect(result.success).toBe(true)
  })

  it('チェックアウト日がチェックイン日以前の行を拒否する', () => {
    const result = ingestReservationsSchema.safeParse({
      hotelId: 'demo-hotel-001',
      capturedDate: '2025-08-11',
      rows: [{ ...validReservation, checkOut: '2025-08-15' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('ingestInventorySchema', () => {
  it('残室スナップショット行を受け入れる（◆HG2608残室.xlsx形式）', () => {
    const result = ingestInventorySchema.safeParse({
      hotelId: 'demo-hotel-001',
      capturedDate: '2026-05-13',
      rows: [
        { stayDate: '2026-08-01', roomTypeCode: 'DSN', remainingRooms: 16, totalRooms: 26 },
        { stayDate: '2026-08-01', roomTypeCode: 'DMN', remainingRooms: 308, totalRooms: 576 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('負の残室数を拒否する', () => {
    const result = ingestInventorySchema.safeParse({
      hotelId: 'demo-hotel-001',
      capturedDate: '2026-05-13',
      rows: [{ stayDate: '2026-08-01', roomTypeCode: 'DSN', remainingRooms: -1 }],
    })
    expect(result.success).toBe(false)
  })
})

describe('upsertSegmentsSchema', () => {
  it('マスタ設定.xlsxのMarket行を受け入れる', () => {
    const result = upsertSegmentsSchema.safeParse({
      hotelId: 'demo-hotel-001',
      kind: 'MARKET',
      items: [
        { code: 'BJ', name: '団体･AGT･募集邦人', aggregateCode: 'BJ' },
        { code: 'IFJ', name: '個人･直･邦人', aggregateCode: 'IF' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('不明なkindを拒否する', () => {
    const result = upsertSegmentsSchema.safeParse({
      hotelId: 'demo-hotel-001',
      kind: 'UNKNOWN_KIND',
      items: [{ code: 'X', name: 'x' }],
    })
    expect(result.success).toBe(false)
  })
})

function reservation(partial: Partial<IngestReservationRow>): IngestReservationRow {
  return {
    checkIn: new Date('2025-08-15T00:00:00Z'),
    checkOut: new Date('2025-08-17T00:00:00Z'),
    roomTypeCode: 'DMN',
    rooms: 1,
    ...partial,
  } as IngestReservationRow
}

describe('expandStayNights', () => {
  it('2泊の予約を計上日2行に展開し室料を均等按分する', () => {
    const nights = expandStayNights(
      reservation({ rooms: 2, guests: 4, roomRevenue: 60000, marketCode: 'IFJ' })
    )
    expect(nights).toHaveLength(2)
    expect(nights[0].stayDate.toISOString().slice(0, 10)).toBe('2025-08-15')
    expect(nights[1].stayDate.toISOString().slice(0, 10)).toBe('2025-08-16')
    expect(nights[0].roomRevenue).toBe(30000)
    expect(nights[1].roomRevenue).toBe(30000)
    expect(nights[0].rooms).toBe(2)
  })

  it('デイユース等の同日IN/OUTでも最低1泊として扱う', () => {
    const nights = expandStayNights(
      reservation({
        checkIn: new Date('2025-08-15T00:00:00Z'),
        checkOut: new Date('2025-08-15T00:00:00Z'),
        roomRevenue: 10000,
      })
    )
    expect(nights).toHaveLength(1)
    expect(nights[0].roomRevenue).toBe(10000)
  })
})

describe('aggregateOnHand', () => {
  it('宿泊日別に室数・売上を積み上げ、タイプ別・マーケット別内訳を持つ', () => {
    const rows = [
      reservation({ rooms: 1, roomRevenue: 20000, marketCode: 'IFJ' }), // 8/15-16 の2泊
      reservation({
        checkIn: new Date('2025-08-16T00:00:00Z'),
        checkOut: new Date('2025-08-17T00:00:00Z'),
        roomTypeCode: 'TSN',
        rooms: 3,
        roomRevenue: 90000,
        marketCode: 'GAJ',
      }),
    ]
    const aggs = aggregateOnHand(rows)
    expect(aggs).toHaveLength(2)

    const day1 = aggs[0]
    expect(day1.stayDate.toISOString().slice(0, 10)).toBe('2025-08-15')
    expect(day1.rooms).toBe(1)
    expect(day1.revenue).toBe(10000)

    const day2 = aggs[1]
    expect(day2.stayDate.toISOString().slice(0, 10)).toBe('2025-08-16')
    expect(day2.rooms).toBe(4) // 1 + 3
    expect(day2.revenue).toBe(100000) // 10000 + 90000
    expect(day2.byRoomType.DMN.rooms).toBe(1)
    expect(day2.byRoomType.TSN.rooms).toBe(3)
    expect(day2.byMarket.IFJ.rooms).toBe(1)
    expect(day2.byMarket.GAJ.rooms).toBe(3)
  })

  it('キャンセル済み予約を積上から除外する', () => {
    const rows = [
      reservation({ rooms: 1 }),
      reservation({ rooms: 5, cancelledAt: new Date('2025-08-01T00:00:00Z') }),
    ]
    const aggs = aggregateOnHand(rows)
    expect(aggs[0].rooms).toBe(1)
  })
})

describe('toUtcDate', () => {
  it('時刻成分を落としてUTC日付に正規化する', () => {
    const d = toUtcDate(new Date('2025-08-15T14:30:00Z'))
    expect(d.toISOString()).toBe('2025-08-15T00:00:00.000Z')
  })
})
