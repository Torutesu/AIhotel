import { describe, it, expect } from 'vitest'
import {
  aggregateByChannel,
  aggregateDaily,
  normalizeReservations,
  parseAmount,
  parseCalendarDate,
  reconstructBookingCurve,
  reservationMappingSchema,
  type ReservationRecord,
} from './reservationImport.js'

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('parseAmount', () => {
  it('桁区切り・通貨記号・円を落として数値にする', () => {
    expect(parseAmount('1,234')).toBe(1234)
    expect(parseAmount('¥12,000')).toBe(12000)
    expect(parseAmount('12000円')).toBe(12000)
  })

  it('空・ハイフン・数値でない値は null', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('-')).toBeNull()
    expect(parseAmount('未定')).toBeNull()
    expect(parseAmount(undefined)).toBeNull()
  })
})

describe('parseCalendarDate', () => {
  it('スラッシュ・ハイフン・詰め書き・和暦表記の区切りを受け付ける', () => {
    expect(parseCalendarDate('2026/09/15')).toEqual(utc('2026-09-15'))
    expect(parseCalendarDate('2026-9-5')).toEqual(utc('2026-09-05'))
    expect(parseCalendarDate('20260915')).toEqual(utc('2026-09-15'))
    expect(parseCalendarDate('2026年9月15日')).toEqual(utc('2026-09-15'))
  })

  it('時刻付きでも暦日だけを取り、タイムゾーンでずらさない', () => {
    expect(parseCalendarDate('2026-09-15 23:30')).toEqual(utc('2026-09-15'))
  })

  it('読めない値は null', () => {
    expect(parseCalendarDate('未定')).toBeNull()
    expect(parseCalendarDate('')).toBeNull()
  })
})

describe('normalizeReservations', () => {
  const mapping = reservationMappingSchema.parse({
    checkInDate: 'チェックイン',
    nights: '泊数',
    rooms: '室数',
    guests: '人数',
    revenue: '合計金額',
    revenueScope: 'per-stay',
    bookedAt: '予約受付日',
    channel: '販売先',
    channelAliases: { じゃらんnet: 'じゃらん' },
  })

  it('泊数ぶんの宿泊日に展開し、総額は泊数で割る', () => {
    const result = normalizeReservations(
      [
        {
          チェックイン: '2026/09/15',
          泊数: '2',
          室数: '1',
          人数: '2',
          合計金額: '30,000',
          予約受付日: '2026/09/01',
          販売先: 'じゃらんnet',
        },
      ],
      mapping
    )

    expect(result.records).toHaveLength(2)
    expect(result.expandedNights).toBe(1)
    expect(result.records[0]).toMatchObject({
      stayDate: utc('2026-09-15'),
      rooms: 1,
      revenue: 15000,
      channel: 'じゃらん',
      bookedOn: utc('2026-09-01'),
    })
    expect(result.records[1].stayDate).toEqual(utc('2026-09-16'))
  })

  it('宿泊日が読めない行はスキップして理由を返す', () => {
    const result = normalizeReservations([{ チェックイン: '', 泊数: '1', 室数: '1' }], mapping)
    expect(result.records).toHaveLength(0)
    expect(result.skipped[0]).toEqual({ row: 1, reason: '宿泊日（またはチェックイン日）が読めない' })
  })

  it('ステータスだけでキャンセルが分かるCSVでも除外対象として数える', () => {
    const statusMapping = reservationMappingSchema.parse({
      stayDate: '宿泊日',
      rooms: '室数',
      status: '状態',
      cancelStatusValues: ['取消'],
    })
    const result = normalizeReservations(
      [
        { 宿泊日: '2026-09-15', 室数: '1', 状態: '確定' },
        { 宿泊日: '2026-09-15', 室数: '2', 状態: '取消' },
      ],
      statusMapping
    )
    expect(result.cancelledRows).toBe(1)
    expect(result.records[0].cancelledOn).toBeNull()
    expect(result.records[1].cancelledOn).toEqual(utc('2026-09-15'))
  })

  it('室数の列が無いCSVは1行1室として扱う', () => {
    const noRooms = reservationMappingSchema.parse({ stayDate: '宿泊日' })
    const result = normalizeReservations([{ 宿泊日: '2026-09-15' }], noRooms)
    expect(result.records[0].rooms).toBe(1)
  })
})

describe('aggregateDaily', () => {
  const base: ReservationRecord = {
    stayDate: utc('2026-09-15'),
    rooms: 1,
    guests: 2,
    revenue: 12000,
    channel: '楽天トラベル',
    roomTypeCode: 'STD_SINGLE',
    bookedOn: utc('2026-09-01'),
    cancelledOn: null,
  }

  it('宿泊日ごとに室数・人数・売上を合計しADRを出す', () => {
    const [row] = aggregateDaily([base, { ...base, rooms: 2, guests: 3, revenue: 30000 }], 100)
    expect(row).toMatchObject({
      date: utc('2026-09-15'),
      soldRooms: 3,
      guests: 5,
      totalRevenue: 42000,
      adr: 14000,
      occupancy: 3,
      revPar: 420,
    })
  })

  it('キャンセル行は実績に含めない', () => {
    const rows = aggregateDaily([base, { ...base, rooms: 5, cancelledOn: utc('2026-09-10') }], 100)
    expect(rows[0].soldRooms).toBe(1)
  })

  it('売上の列が無いCSVでは金額系を null にする（0で埋めない）', () => {
    const [row] = aggregateDaily([{ ...base, revenue: null }], 100)
    expect(row.totalRevenue).toBeNull()
    expect(row.adr).toBeNull()
    expect(row.revPar).toBeNull()
    expect(row.soldRooms).toBe(1)
  })

  it('総客室数が分からないときは稼働率を出さない', () => {
    const [row] = aggregateDaily([base])
    expect(row.occupancy).toBeNull()
  })
})

describe('aggregateByChannel', () => {
  it('宿泊日×販売先で集計する', () => {
    const record: ReservationRecord = {
      stayDate: utc('2026-09-15'),
      rooms: 1,
      guests: null,
      revenue: 10000,
      channel: '楽天トラベル',
      roomTypeCode: null,
      bookedOn: null,
      cancelledOn: null,
    }
    const rows = aggregateByChannel([
      record,
      { ...record, rooms: 2, revenue: 26000 },
      { ...record, channel: 'じゃらん', revenue: 9000 },
    ])
    expect(rows).toEqual([
      { date: utc('2026-09-15'), channel: 'じゃらん', roomsSold: 1, revenue: 9000, adr: 9000 },
      { date: utc('2026-09-15'), channel: '楽天トラベル', roomsSold: 3, revenue: 36000, adr: 12000 },
    ])
  })

  it('販売先の列が無いレコードは集計しない', () => {
    expect(
      aggregateByChannel([
        {
          stayDate: utc('2026-09-15'),
          rooms: 1,
          guests: null,
          revenue: null,
          channel: null,
          roomTypeCode: null,
          bookedOn: null,
          cancelledOn: null,
        },
      ])
    ).toEqual([])
  })
})

describe('reconstructBookingCurve（Issue #24 E2）', () => {
  const record = (bookedOn: string, rooms: number, cancelledOn?: string): ReservationRecord => ({
    stayDate: utc('2026-09-15'),
    rooms,
    guests: null,
    revenue: null,
    channel: null,
    roomTypeCode: null,
    bookedOn: utc(bookedOn),
    cancelledOn: cancelledOn ? utc(cancelledOn) : null,
  })

  it('受付日から「N日前に何室入っていたか」を積み上げる', () => {
    const points = reconstructBookingCurve([record('2026-09-10', 1), record('2026-09-13', 2)], {
      asOf: utc('2026-09-15'),
      maxDaysBefore: 7,
    })
    const at = (daysBefore: number) => points.find((p) => p.daysBefore === daysBefore)?.roomsBooked
    expect(at(6)).toBeUndefined() // 9/9時点はまだ0室なので行を作らない
    expect(at(5)).toBe(1) // 9/10
    expect(at(2)).toBe(3) // 9/13
    expect(at(0)).toBe(3) // 宿泊当日
  })

  it('取消後の時点では取消分を引く', () => {
    const points = reconstructBookingCurve([record('2026-09-01', 3, '2026-09-14')], {
      asOf: utc('2026-09-15'),
      maxDaysBefore: 3,
    })
    expect(points.find((p) => p.daysBefore === 2)?.roomsBooked).toBe(3) // 9/13
    expect(points.find((p) => p.daysBefore === 1)).toBeUndefined() // 9/14に取消 → 0室
  })

  it('データ取得日より未来の時点は作らない', () => {
    const points = reconstructBookingCurve([record('2026-09-01', 1)], {
      asOf: utc('2026-09-12'),
      maxDaysBefore: 30,
    })
    expect(Math.min(...points.map((p) => p.daysBefore))).toBe(3) // 9/12 = 宿泊3日前まで
  })

  it('受付日が無いCSVではカーブを作れない（A2が必須の理由）', () => {
    const points = reconstructBookingCurve(
      [{ ...record('2026-09-01', 1), bookedOn: null }],
      { asOf: utc('2026-09-15') }
    )
    expect(points).toEqual([])
  })
})
