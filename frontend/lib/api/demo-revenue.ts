// デモモード用のサンプルデータ（2026-10 のデモ画面の修正）。
// 料金カレンダーの予算・オンハンド・日のタイプ、ブッキングカーブの参考カーブ・予算・料金履歴、
// 日別パフォーマンス、周辺の新規ホテル、イベントの取り込みを、バックエンドと同じ形で返す。
// NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われる（実データではない）。
// 日のタイプの判定の正は backend/src/services/forecast/dayType.ts。ここはデモ表示のための同じ考え方の簡易版。

import type { Event as HotelEvent } from "@shared/types"
import { createSeededRandom } from "@/lib/format"
import { MOCK_HOTEL } from "./client"
import {
  getMockEvents,
  isMockWeekend,
  mockBudgetValues,
  mockDaysInMonth,
  mockSeasonBoost,
  setMockEvents,
  toLocalDateStr,
  type mockPricingCalendar,
} from "./demo-data"
import type {
  BookingCurve,
  BookingCurvePoint,
  DailyPerformance,
  DayMetrics,
  DayTypeHistoryPoint,
  EventImportRow,
  ImportResult,
  NewHotelInput,
  NewHotelOpening,
  PricingCalendar,
} from "./types"

const DAY_MS = 86_400_000
const HISTORY_LEADS = [90, 60, 30, 14, 7, 3, 1, 0]

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function leadDays(stay: Date, today = startOfLocalDay(new Date())): number {
  return Math.round((startOfLocalDay(stay).getTime() - today.getTime()) / DAY_MS)
}

/** 残日数 lead の時点で最終の何割が予約済みか（週末は早く埋まる） */
function curveProgress(lead: number, weekend: boolean): number {
  if (lead <= 0) return 1
  if (lead >= 190) return 0
  return Math.pow(1 - lead / 190, weekend ? 1.5 : 1.9)
}

function grade(occupancy: number): string {
  if (occupancy > 0.9) return "A"
  if (occupancy > 0.8) return "B"
  if (occupancy > 0.65) return "C"
  if (occupancy > 0.5) return "D"
  return "E"
}

function gradePace(ratio: number): number {
  if (ratio >= 1.2) return 1
  if (ratio >= 1.05) return 2
  if (ratio > 0.95) return 3
  if (ratio > 0.8) return 4
  return 5
}

/** 日のタイプ（英字 = 着地見込みの需要、数字 = 前年同曜日と比べたペース） */
export function demoDayType(
  otb: number | null,
  lastYearOtb: number | null,
  lastYearFinal: number | null,
  totalRooms: number,
  fallbackOccupancy: number | null = null,
): { dayType: string | null; expectedOccupancy: number | null; paceRatio: number | null } {
  const paceRatio = otb != null && lastYearOtb != null && lastYearOtb >= 3 ? otb / lastYearOtb : null
  let expected: number | null = null
  if (otb != null && lastYearOtb != null && lastYearFinal != null) expected = otb + Math.max(0, lastYearFinal - lastYearOtb)
  else if (fallbackOccupancy != null) expected = Math.max(otb ?? 0, fallbackOccupancy * totalRooms)
  if (expected == null || totalRooms <= 0) return { dayType: null, expectedOccupancy: null, paceRatio: null }
  const expectedOccupancy = Math.round(Math.min(1, expected / totalRooms) * 1000) / 1000
  return {
    dayType: `${grade(expectedOccupancy)}${paceRatio == null ? "" : gradePace(paceRatio)}`,
    expectedOccupancy,
    paceRatio: paceRatio == null ? null : Math.round(paceRatio * 100) / 100,
  }
}

/** 1日ぶんの予約の入り方（今年・前年）。日付から決まる */
function demoDayCurve(stay: Date, finalOccupancy: number) {
  const totalRooms = MOCK_HOTEL.totalRooms
  const weekend = isMockWeekend(stay)
  const seed = stay.getFullYear() * 10000 + (stay.getMonth() + 1) * 100 + stay.getDate()
  const rng = createSeededRandom(seed * 7 + 3)
  const finalRooms = Math.round(totalRooms * finalOccupancy)
  // 前年は今年より少し弱い（稼働 −2〜−6%）
  const lastYearFinal = Math.round(finalRooms * (0.94 + rng() * 0.04))
  const noise = new Map<number, [number, number]>()
  const at = (lead: number): [number, number] => {
    if (!noise.has(lead)) noise.set(lead, [0.9 + rng() * 0.18, 0.92 + rng() * 0.14])
    const [a, b] = noise.get(lead) as [number, number]
    const p = curveProgress(lead, weekend)
    return [Math.min(finalRooms, Math.round(finalRooms * p * (lead === 0 ? 1 : a))), Math.min(lastYearFinal, Math.round(lastYearFinal * p * (lead === 0 ? 1 : b)))]
  }
  return { finalRooms, lastYearFinal, at, weekend }
}

/** 月の予算を前年同曜日の販売室数の比で日に配る（バックエンドの budgetAllocation.ts と同じ考え方） */
function demoDailyBudgets(year: number, month: number, weights: number[]) {
  const budget = mockBudgetValues(year, month)
  const totalRooms = MOCK_HOTEL.totalRooms
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  return weights.map((w) => {
    const share = w / sum
    const rooms = Math.min(totalRooms, (budget.budgetRooms ?? 0) * share)
    const revenue = rooms * (budget.budgetAdr ?? 0)
    return {
      rooms: Math.round(rooms),
      occupancy: Math.round((rooms / totalRooms) * 1000) / 1000,
      adr: budget.budgetAdr ?? null,
      revenue: Math.round(revenue),
      revPar: Math.round(revenue / totalRooms),
    }
  })
}

/** 料金カレンダーのデモに、予算・オンハンド・想定売上・日のタイプを足す */
export function enrichMockPricingCalendar(calendar: ReturnType<typeof mockPricingCalendar>): PricingCalendar {
  const totalRooms = MOCK_HOTEL.totalRooms
  const today = startOfLocalDay(new Date())
  const curves = calendar.calendar.map((day) => {
    const stay = new Date(`${day.date}T00:00:00`)
    const finalOccupancy = day.actualOccupancy ?? day.predictedOccupancy ?? 0.7
    return { stay, curve: demoDayCurve(stay, finalOccupancy) }
  })
  const budgets = demoDailyBudgets(calendar.year, calendar.month, curves.map((c) => c.curve.lastYearFinal))

  return {
    ...calendar,
    totalRooms,
    calendar: calendar.calendar.map((day, i) => {
      const { stay, curve } = curves[i]
      const lead = leadDays(stay, today)
      const isPast = lead < 0
      const rng = createSeededRandom(stay.getTime() / DAY_MS + 11)
      const [otbNow, lastYearNow] = curve.at(Math.max(0, lead))
      const onHandRooms = isPast ? curve.finalRooms : otbNow
      const current = isPast
        ? demoDayType(curve.finalRooms, curve.lastYearFinal, curve.lastYearFinal, totalRooms)
        : demoDayType(otbNow, lastYearNow, curve.lastYearFinal, totalRooms, day.predictedOccupancy)
      const history: DayTypeHistoryPoint[] = HISTORY_LEADS.filter((l) => l > lead).map((l) => {
        const [otb, ly] = curve.at(l)
        const r = demoDayType(otb, ly, curve.lastYearFinal, totalRooms)
        return { daysBefore: l, dayType: r.dayType, otbRooms: otb, paceRatio: r.paceRatio }
      })
      // 予約の単価（PMS 連携後に入る値のデモ）。先の日は予測ADRの 9割前後から
      const onHandAdr = day.actualAdr ?? (day.predictedAdr != null ? Math.round(day.predictedAdr * (0.88 + rng() * 0.1)) : null)
      const expectedRooms = day.predictedOccupancy != null ? Math.round(totalRooms * day.predictedOccupancy) : null
      const expectedAdr = day.predictedAdr ?? day.recommendedPrice
      return {
        ...day,
        budgetRooms: budgets[i].rooms,
        budgetOccupancy: budgets[i].occupancy,
        budgetAdr: budgets[i].adr,
        budgetRevenue: budgets[i].revenue,
        onHandRooms,
        currentOccupancy: day.actualOccupancy ?? Math.round((onHandRooms / totalRooms) * 1000) / 1000,
        onHandAdr,
        currentRevenue: onHandAdr != null ? Math.round(onHandRooms * onHandAdr) : null,
        expectedRevenue: expectedRooms != null && expectedAdr != null ? expectedRooms * expectedAdr : null,
        dayType: current.dayType,
        dayTypeExpectedOccupancy: current.expectedOccupancy,
        dayTypePaceRatio: current.paceRatio,
        dayTypeHistory: history,
      }
    }),
  }
}

/** ブッキングカーブのデモ（予約日ごとの積上・前年同曜日・予算・料金履歴・団体） */
export function mockBookingCurveDetail(hotelId: string, date: string): BookingCurve {
  const totalRooms = MOCK_HOTEL.totalRooms
  const stay = new Date(`${date}T00:00:00`)
  const boost = mockSeasonBoost(stay.getMonth() + 1)
  const weekend = isMockWeekend(stay)
  const seedRng = createSeededRandom(stay.getFullYear() * 10000 + (stay.getMonth() + 1) * 100 + stay.getDate())
  const finalOccupancy = Math.min(0.98, (weekend ? 0.92 : 0.74) * boost + (seedRng() - 0.5) * 0.1)
  const curve = demoDayCurve(stay, finalOccupancy)
  const lead = leadDays(stay)
  const occ = (rooms: number) => Math.round((rooms / totalRooms) * 1000) / 1000

  const leads = Array.from({ length: 121 }, (_, i) => 120 - i)
  // 予約積上は今日の時点まで（先の残日数はまだ来ていない）
  let booked = 0
  const points: BookingCurvePoint[] = []
  let lastYearBooked = 0
  const reference: BookingCurvePoint[] = []
  for (const l of leads) {
    const [otb, ly] = curve.at(l)
    lastYearBooked = Math.max(lastYearBooked, ly)
    reference.push({ daysBefore: l, roomsBooked: lastYearBooked, occupancy: occ(lastYearBooked) })
    if (l < lead) continue
    booked = Math.max(booked, otb)
    points.push({ daysBefore: l, roomsBooked: booked, occupancy: occ(booked) })
  }

  const budget = mockBudgetValues(stay.getFullYear(), stay.getMonth() + 1)
  const baseAdr = Math.round((weekend ? 24000 : 17000) * boost)
  const priceRng = createSeededRandom(stay.getTime() / DAY_MS + 29)
  // 販売価格は2〜3週ごとに段階的に変える。直前は空室に合わせて下げる
  let price = Math.round((baseAdr * (1.02 + priceRng() * 0.08)) / 100) * 100
  const rateHistory: Array<{ daysBefore: number; price: number | null }> = []
  const adrHistory: Array<{ daysBefore: number; adr: number | null }> = []
  const groupRooms: Array<{ daysBefore: number; rooms: number }> = []
  for (const l of leads) {
    if (l < lead) break
    if (l % 18 === 0 && l > 0) price = Math.round((price * (0.94 + priceRng() * 0.14)) / 100) * 100
    if (l === 7) price = Math.round((price * 0.85) / 100) * 100
    rateHistory.push({ daysBefore: l, price })
    adrHistory.push({ daysBefore: l, adr: Math.round(baseAdr * (0.97 - (120 - l) * 0.0006) + priceRng() * 200) })
    groupRooms.push({ daysBefore: l, rooms: l > 95 ? 0 : l > 12 ? 6 : 12 })
  }

  return {
    hotelId,
    stayDate: date,
    totalRooms,
    points,
    reference: {
      date: toLocalDateStr(new Date(stay.getTime() - 364 * DAY_MS)),
      points: reference,
      finalRooms: curve.lastYearFinal,
      finalOccupancy: occ(curve.lastYearFinal),
      adr: Math.round(baseAdr * 0.95),
    },
    budget: {
      rooms: budget.budgetOccupancy != null ? Math.round(budget.budgetOccupancy * totalRooms * (weekend ? 1.12 : 0.95)) : null,
      occupancy: budget.budgetOccupancy != null ? Math.min(1, Number((budget.budgetOccupancy * (weekend ? 1.12 : 0.95)).toFixed(3))) : null,
      adr: budget.budgetAdr ?? null,
    },
    prediction: { occupancy: Number(finalOccupancy.toFixed(3)), rooms: curve.finalRooms, adr: baseAdr },
    actual: lead < 0 ? { soldRooms: curve.finalRooms, occupancy: occ(curve.finalRooms), adr: baseAdr } : null,
    adrHistory,
    rateHistory,
    groupRooms,
  }
}

/** 日別パフォーマンスのデモ（実績・日割り予算・AI の予測・前年同曜日） */
export function mockDailyPerformance(hotelId: string, year: number, month: number): DailyPerformance {
  const totalRooms = MOCK_HOTEL.totalRooms
  const today = startOfLocalDay(new Date())
  const boost = mockSeasonBoost(month)
  const numDays = mockDaysInMonth(year, month)
  const metrics = (rooms: number, adr: number): DayMetrics => ({
    soldRooms: rooms,
    occupancy: Math.round((rooms / totalRooms) * 1000) / 1000,
    adr,
    revPar: Math.round((rooms * adr) / totalRooms),
    revenue: rooms * adr,
  })
  const base = Array.from({ length: numDays }, (_, i) => {
    const date = new Date(year, month - 1, i + 1)
    const weekend = isMockWeekend(date)
    const rng = createSeededRandom(date.getTime() / DAY_MS + 101)
    const aiOcc = Math.min(1, Math.max(0.3, (weekend ? 0.9 : 0.72) * boost + (rng() - 0.5) * 0.06))
    const aiAdr = Math.round((weekend ? 24000 : 17000) * boost)
    const actualOcc = Math.min(1, Math.max(0.3, aiOcc + (rng() - 0.5) * 0.12))
    const actualAdr = Math.round(aiAdr * (0.95 + rng() * 0.1))
    const lyRooms = Math.round(totalRooms * actualOcc * (0.92 + rng() * 0.06))
    const lyAdr = Math.round(actualAdr * (0.93 + rng() * 0.05))
    return { date, aiOcc, aiAdr, actualOcc, actualAdr, lyRooms, lyAdr }
  })
  const budgets = demoDailyBudgets(year, month, base.map((b) => b.lyRooms))
  return {
    hotelId,
    year,
    month,
    totalRooms,
    days: base.map((b, i) => ({
      date: toLocalDateStr(b.date),
      actual: b.date <= today ? metrics(Math.round(totalRooms * b.actualOcc), b.actualAdr) : null,
      budget: {
        soldRooms: budgets[i].rooms,
        occupancy: budgets[i].occupancy,
        adr: budgets[i].adr,
        revPar: budgets[i].revPar,
        revenue: budgets[i].revenue,
      },
      ai: metrics(Math.round(totalRooms * b.aiOcc), b.aiAdr),
      lastYearDate: toLocalDateStr(new Date(b.date.getTime() - 364 * DAY_MS)),
      lastYear: metrics(b.lyRooms, b.lyAdr),
    })),
  }
}

// ---- 周辺の新規ホテル ----

let mockNewHotels: NewHotelOpening[] | null = null

export function getMockNewHotels(hotelId: string): NewHotelOpening[] {
  if (mockNewHotels) return mockNewHotels
  const today = new Date()
  const day = (offset: number) => toLocalDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset))
  mockNewHotels = [
    { id: "mock-new-hotel-1", hotelId, name: "ステーションホテル新館", openingDate: day(45), rooms: 220, category: "ビジネス", location: "駅北口", distanceKm: 0.4, expectedImpact: "high", notes: "同価格帯。開業月は割引販売の見込み" },
    { id: "mock-new-hotel-2", hotelId, name: "グランドリゾート湾岸", openingDate: day(150), rooms: 310, category: "リゾート", location: "湾岸エリア", distanceKm: 3.2, expectedImpact: "medium", notes: "上位カテゴリ。週末の需要を取り合う" },
    { id: "mock-new-hotel-3", hotelId, name: "カプセルイン中央", openingDate: day(-40), rooms: 160, category: "カプセル", location: "中央通り", distanceKm: 0.9, expectedImpact: "low", notes: "開業済み。客層は重なりにくい" },
  ]
  return mockNewHotels
}

const sortByOpening = (list: NewHotelOpening[]) =>
  [...list].sort((a, b) => a.openingDate.localeCompare(b.openingDate) || a.name.localeCompare(b.name))

export function addMockNewHotel(hotelId: string, input: NewHotelInput): NewHotelOpening {
  const created: NewHotelOpening = {
    id: `mock-new-hotel-${Date.now()}`,
    hotelId,
    name: input.name,
    openingDate: input.openingDate,
    rooms: input.rooms ?? null,
    category: input.category ?? null,
    location: input.location ?? null,
    distanceKm: input.distanceKm ?? null,
    expectedImpact: input.expectedImpact ?? null,
    notes: input.notes ?? null,
  }
  mockNewHotels = sortByOpening([...getMockNewHotels(hotelId), created])
  return created
}

export function updateMockNewHotel(hotelId: string, id: string, input: Partial<NewHotelInput>): NewHotelOpening {
  const list = getMockNewHotels(hotelId)
  const current = list.find((h) => h.id === id)
  if (!current) throw new Error("新規ホテルが見つかりません")
  const updated = { ...current, ...input } as NewHotelOpening
  mockNewHotels = sortByOpening(list.map((h) => (h.id === id ? updated : h)))
  return updated
}

export function removeMockNewHotel(hotelId: string, id: string): void {
  mockNewHotels = getMockNewHotels(hotelId).filter((h) => h.id !== id)
}

/** 取り込み（同じ名前・同じ開業日は上書き）。dryRun なら件数だけ */
export function importMockNewHotels(hotelId: string, rows: NewHotelInput[], dryRun: boolean): ImportResult {
  const list = getMockNewHotels(hotelId)
  const key = (h: { name: string; openingDate: string }) => `${h.name}\u0000${h.openingDate}`
  const existing = new Map(list.map((h) => [key(h), h]))
  const updated = rows.filter((r) => existing.has(key(r))).length
  const dates = rows.map((r) => r.openingDate).sort()
  if (!dryRun) {
    for (const row of rows) {
      const found = existing.get(key(row))
      if (found) updateMockNewHotel(hotelId, found.id, row)
      else addMockNewHotel(hotelId, row)
    }
  }
  return { dryRun, total: rows.length, created: rows.length - updated, updated, startDate: dates[0], endDate: dates[dates.length - 1] }
}

/** イベントの取り込み（同じ名前・同じ開始日は上書き）。dryRun なら件数だけ */
export function importMockEvents(hotelId: string, rows: EventImportRow[], dryRun: boolean): ImportResult {
  const list = getMockEvents(hotelId)
  const dateKey = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : toLocalDateStr(d))
  const key = (name: string, start: Date | string) => `${name}\u0000${dateKey(start)}`
  const existing = new Map(list.map((e) => [key(e.name, e.startDate), e]))
  const updated = rows.filter((r) => existing.has(key(r.name, r.startDate))).length
  const starts = rows.map((r) => r.startDate).sort()
  const ends = rows.map((r) => r.endDate).sort()
  if (!dryRun) {
    let next = [...list]
    rows.forEach((row, i) => {
      const found = existing.get(key(row.name, row.startDate))
      const event: HotelEvent = {
        id: found?.id ?? `mock-event-import-${Date.now()}-${i}`,
        hotelId,
        name: row.name,
        type: row.type,
        startDate: new Date(`${row.startDate}T00:00:00`),
        endDate: new Date(`${row.endDate}T00:00:00`),
        location: row.location,
        expectedImpact: row.expectedImpact,
        description: row.description,
        excludeFromHistory: row.excludeFromHistory,
      }
      next = found ? next.map((e) => (e.id === found.id ? event : e)) : [...next, event]
    })
    setMockEvents(next)
  }
  return { dryRun, total: rows.length, created: rows.length - updated, updated, startDate: starts[0], endDate: ends[ends.length - 1] }
}
