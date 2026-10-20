// デモモード用のサンプルデータ（2026-10 のデモ画面の修正）。
// 料金カレンダーの予算・オンハンド・日のタイプ、ブッキングカーブの参考カーブ・予算・料金履歴、
// 日別パフォーマンス、周辺の新規ホテル、イベントの取り込みを、バックエンドと同じ形で返す。
// NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われる（実データではない）。
// 日のタイプの判定の正は backend/src/services/forecast/dayType.ts。ここはデモ表示のための同じ手順の簡易版（型は固定）。

import type { Event as HotelEvent } from "@shared/types"
import { createSeededRandom } from "@/lib/format"
import { MOCK_HOTEL } from "./client"
import {
  getMockEvents,
  isMockWeekend,
  mockBudgetValues,
  mockDashboardKpi,
  mockDaysInMonth,
  mockSeasonBoost,
  mockRankToPrice1P,
  mockStrategy,
  setMockEvents,
  toLocalDateStr,
  mockPricingCalendar,
} from "./demo-data"
import type {
  BookingCurve,
  BookingCurvePoint,
  DailyPerformance,
  DayInsight,
  DayOfWeekBreakdown,
  DayTypeBreakdown,
  DayMetrics,
  DayModel,
  DayTypeHistoryPoint,
  EventImportRow,
  ImportResult,
  MonthPace,
  NewHotelInput,
  NewHotelOpening,
  PerformanceRow,
  PricingCalendar,
  DaySimulation,
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

export type DemoDayCategory = "平日" | "週末" | "特日"

/** デモの日のタイプ。実データではバックエンドが過去の結果から型を作る（型の数もデータで決まる）。デモは固定の型を使う */
export const MOCK_DAY_TYPES: Array<{ name: string; category: DemoDayCategory; avgOccupancy: number; avgAdr: number; model: DayModel }> = [
  { name: "平日A型", category: "平日", avgOccupancy: 0.82, avgAdr: 18_400, model: "balanced" },
  { name: "平日B型", category: "平日", avgOccupancy: 0.7, avgAdr: 16_600, model: "balanced" },
  { name: "平日C型", category: "平日", avgOccupancy: 0.58, avgAdr: 15_200, model: "occupancy" },
  { name: "週末A型", category: "週末", avgOccupancy: 0.93, avgAdr: 25_800, model: "adr" },
  { name: "週末B型", category: "週末", avgOccupancy: 0.82, avgAdr: 22_300, model: "balanced" },
  { name: "特日A型", category: "特日", avgOccupancy: 0.95, avgAdr: 28_500, model: "adr" },
]

/** 特日（祝日・お盆・年末年始・GW。画面の曜日欄の色と同じ一覧）・週末・平日 */
export function demoDayCategory(date: Date): DemoDayCategory {
  const m = date.getMonth() + 1
  const d = date.getDate()
  const holidays = ["1-1", "2-11", "2-23", "4-29", "5-3", "5-4", "5-5", "8-11", "11-3", "11-23"]
  const special =
    holidays.includes(`${m}-${d}`) || (m === 8 && d >= 13 && d <= 16) || (m === 12 && d >= 29) || (m === 1 && d <= 3) || (m === 4 && d >= 29) || (m === 5 && d <= 5)
  if (special) return "特日"
  return isMockWeekend(date) ? "週末" : "平日"
}

/**
 * デモの日のタイプの判定（バックエンドの classifyDay と同じ手順）。
 * 結果があれば最終の稼働率、予約の記録があればその残日数の典型の予約室数との近さ、無ければ予測稼働率で一番近い型
 */
export function demoClassifyDay(
  stay: Date,
  input: { lead: number; otbRooms: number | null; finalRooms?: number | null; predictedOccupancy?: number | null },
): (typeof MOCK_DAY_TYPES)[number] | null {
  const totalRooms = MOCK_HOTEL.totalRooms
  const types = MOCK_DAY_TYPES.filter((t) => t.category === demoDayCategory(stay))
  if (types.length === 0) return null
  const nearestBy = (value: (t: (typeof types)[number]) => number, target: number) =>
    types.reduce((best, t) => (Math.abs(value(t) - target) < Math.abs(value(best) - target) ? t : best))
  if (input.finalRooms != null) return nearestBy((t) => t.avgOccupancy, input.finalRooms / totalRooms)
  if (input.otbRooms != null && input.lead < 190) {
    const share = curveProgress(input.lead, isMockWeekend(stay))
    return nearestBy((t) => share * t.avgOccupancy * totalRooms, input.otbRooms)
  }
  if (input.predictedOccupancy != null) return nearestBy((t) => t.avgOccupancy, input.predictedOccupancy)
  return null
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
      const [otbNow] = curve.at(Math.max(0, lead))
      const onHandRooms = isPast ? curve.finalRooms : otbNow
      const current = isPast
        ? demoClassifyDay(stay, { lead: 0, otbRooms: curve.finalRooms, finalRooms: curve.finalRooms })
        : demoClassifyDay(stay, { lead, otbRooms: otbNow, predictedOccupancy: day.predictedOccupancy })
      const history: DayTypeHistoryPoint[] = HISTORY_LEADS.filter((l) => l > lead).map((l) => {
        const [otb] = curve.at(l)
        const type = demoClassifyDay(stay, { lead: l, otbRooms: otb, finalRooms: l === 0 ? otb : null })
        return { daysBefore: l, dayType: type?.name ?? null, otbRooms: otb }
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
        dayType: current?.name ?? null,
        dayTypeModel: current?.model ?? null,
        dayTypeTypicalOccupancy: current?.avgOccupancy ?? null,
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
    breakdowns: demoCurveBreakdowns(points, adrHistory),
  }
}

/** 部屋タイプ別・利用人数別の予約の積み上がり（デモ。実データは予約明細 — PMS 連携後） */
function demoCurveBreakdowns(points: BookingCurvePoint[], adrHistory: Array<{ daysBefore: number; adr: number | null }>) {
  const adrAt = new Map(adrHistory.map((a) => [a.daysBefore, a.adr]))
  const split = (shares: Array<{ label: string; share: number; adrFactor: number }>) =>
    shares.map(({ label, share, adrFactor }) => ({
      label,
      points: points.map((p) => {
        const adr = adrAt.get(p.daysBefore)
        return { daysBefore: p.daysBefore, roomsBooked: Math.round(p.roomsBooked * share), adr: adr != null ? Math.round(adr * adrFactor) : null }
      }),
    }))
  return {
    roomType: split([
      { label: "スタンダードダブル", share: 0.5, adrFactor: 0.9 },
      { label: "デラックスツイン", share: 0.35, adrFactor: 1.08 },
      { label: "スイート", share: 0.15, adrFactor: 1.45 },
    ]),
    guests: split([
      { label: "1名", share: 0.38, adrFactor: 0.82 },
      { label: "2名", share: 0.5, adrFactor: 1.06 },
      { label: "3名以上", share: 0.12, adrFactor: 1.3 },
    ]),
  }
}

/** デモの月の料金カレンダー（予算・日のタイプ入り） */
function demoCalendarMonth(year: number, month: number) {
  return enrichMockPricingCalendar(mockPricingCalendar(MOCK_HOTEL.id, year, month)).calendar
}

/** 日のAI分析のデモ（バックエンドの getDayInsightService と同じ形） */
export function mockDayInsight(hotelId: string, date: string): DayInsight {
  void hotelId
  const totalRooms = MOCK_HOTEL.totalRooms
  const stay = new Date(`${date}T00:00:00`)
  // 前後60日（同じタイプの日を探す範囲）にかかる月のカレンダー
  const months = new Set<string>()
  for (let i = -60; i <= 60; i += 15) {
    const d = new Date(stay.getFullYear(), stay.getMonth(), stay.getDate() + i)
    months.add(`${d.getFullYear()}-${d.getMonth() + 1}`)
  }
  const last = new Date(stay.getFullYear(), stay.getMonth(), stay.getDate() + 60)
  months.add(`${last.getFullYear()}-${last.getMonth() + 1}`)
  const days = [...months].flatMap((key) => {
    const [y, m] = key.split("-").map(Number)
    return demoCalendarMonth(y, m)
  })
  const self = days.find((d) => d.date === date)
  const type = MOCK_DAY_TYPES.find((t) => t.name === self?.dayType) ?? null
  const category = demoDayCategory(stay)
  const range = days.filter((d) => Math.abs(new Date(`${d.date}T00:00:00`).getTime() - stay.getTime()) <= 60 * DAY_MS && d.date !== date)
  const distance = (d: string) => Math.abs(new Date(`${d}T00:00:00`).getTime() - stay.getTime())
  const similar = type
    ? range
        .filter((d) => d.dayType === type.name)
        .sort((a, b) => distance(a.date) - distance(b.date))
        .slice(0, 5)
        .sort((a, b) => a.date.localeCompare(b.date))
    : []
  const weekendCurve = category !== "平日"
  return {
    date,
    category,
    dayType: type ? { name: type.name, model: type.model, typicalOccupancy: type.avgOccupancy } : null,
    history: self?.dayTypeHistory ?? [],
    typeProfile: type
      ? {
          name: type.name,
          model: type.model,
          days: 40,
          avgOccupancy: type.avgOccupancy,
          minOccupancy: Math.max(0, type.avgOccupancy - 0.05),
          maxOccupancy: Math.min(1, type.avgOccupancy + 0.05),
          avgAdr: type.avgAdr,
          referenceCurve: [180, 120, 90, 60, 45, 30, 21, 14, 7, 3, 1, 0].map((l) => ({
            daysBefore: l,
            roomsBooked: Math.round(curveProgress(l, weekendCurve) * type.avgOccupancy * totalRooms),
          })),
        }
      : null,
    categoryTypes: MOCK_DAY_TYPES.filter((t) => t.category === category).map((t) => ({
      name: t.name,
      model: t.model,
      days: 40,
      avgOccupancy: t.avgOccupancy,
      avgAdr: t.avgAdr,
    })),
    similarDays: similar.map((d) => ({
      date: d.date,
      dayType: d.dayType as string,
      isActual: d.actualOccupancy != null,
      occupancy: d.actualOccupancy ?? d.predictedOccupancy,
      adr: d.actualAdr ?? d.predictedAdr,
      recommendedPrice: d.recommendedPrice,
    })),
    events: getMockEvents(MOCK_HOTEL.id)
      .filter((e) => {
        const key = (v: Date | string) => (typeof v === "string" ? v : v.toISOString()).slice(0, 10)
        return key(e.startDate) <= date && date <= key(e.endDate)
      })
      .map((e) => ({
        name: e.name,
        type: e.type,
        location: e.location ?? null,
        expectedImpact: e.expectedImpact ?? null,
        excludeFromHistory: Boolean(e.excludeFromHistory),
      })),
    weather: null,
  }
}

const MODEL_RANK_OFFSET: Record<DayModel, number> = { occupancy: -2, balanced: 0, adr: 2 }

/** 日単位のシミュレーションのデモ（バックエンドの getDaySimulationService と同じ形・同じ価格弾力性の考え方） */
export function mockDaySimulation(hotelId: string, date: string, rank?: number): DaySimulation {
  void hotelId
  const totalRooms = MOCK_HOTEL.totalRooms
  const stay = new Date(`${date}T00:00:00`)
  const day = demoCalendarMonth(stay.getFullYear(), stay.getMonth() + 1).find((d) => d.date === date)
  const aiModel = day?.dayTypeModel ?? null
  const elasticity = 1
  const otbRooms = day?.onHandRooms ?? null
  const baseRank = day?.recommendedRank ?? 20
  const baseAdr = day?.predictedAdr ?? day?.recommendedPrice ?? 15_000
  const baseOccupancy = day?.predictedOccupancy ?? 0.7
  const balancedRank = baseRank - (aiModel ? MODEL_RANK_OFFSET[aiModel] : 0)
  const basePrice = mockRankToPrice1P(baseRank)
  const occupancyAt = (adr: number) => {
    const floor = otbRooms != null ? Math.min(1, otbRooms / totalRooms) : 0
    return Math.round(Math.max(floor, Math.min(1, baseOccupancy * Math.pow(adr / baseAdr, -elasticity))) * 1000) / 1000
  }
  const outcome = (occupancy: number, adr: number) => {
    const rooms = Math.round(occupancy * totalRooms)
    const revenue = Math.round(rooms * adr)
    return { occupancy, rooms, revenue, revPar: Math.round(revenue / totalRooms) }
  }
  const at = (r: number) => {
    const clamped = Math.min(40, Math.max(1, r))
    const price = mockRankToPrice1P(clamped)
    const adr = Math.round(baseAdr * (price / basePrice))
    return { rank: clamped, price, adr, ...outcome(occupancyAt(adr), adr) }
  }
  const w = mockStrategy
  const weightsFor = (model: DayModel) => {
    if (model === "occupancy") {
      const move = Math.min(20, w.weightAdr)
      return { occupancy: w.weightOccupancy + move, adr: w.weightAdr - move, competitor: w.weightCompetitor }
    }
    if (model === "adr") {
      const move = Math.min(20, w.weightOccupancy)
      return { occupancy: w.weightOccupancy - move, adr: w.weightAdr + move, competitor: w.weightCompetitor }
    }
    return { occupancy: w.weightOccupancy, adr: w.weightAdr, competitor: w.weightCompetitor }
  }
  return {
    date,
    totalRooms,
    otbRooms,
    elasticity,
    aiModel,
    dayType: day?.dayType ?? null,
    base: { rank: baseRank, price: basePrice, adr: baseAdr, ...outcome(baseOccupancy, baseAdr) },
    options: (["occupancy", "balanced", "adr"] as const).map((model) => ({
      model,
      ...at(balancedRank + MODEL_RANK_OFFSET[model]),
      weights: weightsFor(model),
      isCurrent: aiModel === model,
    })),
    manual: rank != null ? { model: "manual" as const, ...at(rank), weights: null, isCurrent: false } : null,
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
  // 予約実数（今の予約室数。予約の単価・売上は PMS 連携後のため出さない）
  const onHandOf = (rooms: number): DayMetrics => ({
    soldRooms: rooms,
    occupancy: Math.round((rooms / totalRooms) * 1000) / 1000,
    adr: null,
    revPar: null,
    revenue: null,
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
  // 結果の出た日の実績はダッシュボードのデモ（mockDashboardKpi）の日別実績にそろえる（月間サマリー・曜日別と同じ値になるように）
  const trend = new Map(mockDashboardKpi(hotelId, year, month).dailyTrend.map((t) => [t.date, t]))
  const actualOf = (b: (typeof base)[number]): DayMetrics | null => {
    if (b.date > today) return null
    const t = trend.get(toLocalDateStr(b.date))
    if (t?.occupancy != null && t.adr != null) return metrics(Math.round(t.occupancy * totalRooms), t.adr)
    return metrics(Math.round(totalRooms * b.actualOcc), b.actualAdr)
  }
  return {
    hotelId,
    year,
    month,
    totalRooms,
    days: base.map((b, i) => ({
      date: toLocalDateStr(b.date),
      actual: actualOf(b),
      onHand: b.date <= today ? null : onHandOf(Math.round(totalRooms * b.aiOcc * curveProgress(leadDays(b.date, today), isMockWeekend(b.date)))),
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

/** 曜日別・日のタイプ別のデモの集計（バックエンドの monthPerformance.ts の aggregatePerformance と同じ数え方） */
function demoAggregatePerformance(days: DailyPerformance["days"], totalRooms: number): PerformanceRow {
  const counted = days.filter((d) => d.actual?.soldRooms != null || d.onHand?.soldRooms != null)
  const actual = counted.filter((d) => d.actual?.soldRooms != null)
  const actualRooms = actual.reduce((a, d) => a + (d.actual?.soldRooms ?? 0), 0)
  const onHandRooms = counted.filter((d) => d.actual == null).reduce((a, d) => a + (d.onHand?.soldRooms ?? 0), 0)
  const revenue = actual.reduce((a, d) => a + (d.actual?.revenue ?? 0), 0)
  const soldRooms = actualRooms + onHandRooms
  const capacity = totalRooms * counted.length
  const ly = counted.map((d) => d.lastYear).filter((m): m is DayMetrics => m?.soldRooms != null)
  const lyRooms = ly.reduce((a, m) => a + (m.soldRooms ?? 0), 0)
  const lyRevenue = ly.reduce((a, m) => a + (m.revenue ?? 0), 0)
  const round3 = (v: number) => Math.round(v * 1000) / 1000
  return {
    days: counted.length,
    actualDays: actual.length,
    soldRooms,
    onHandRooms,
    revenue: Math.round(revenue),
    occupancy: capacity > 0 ? round3(soldRooms / capacity) : null,
    adr: actualRooms > 0 ? Math.round(revenue / actualRooms) : null,
    revPar: actual.length > 0 ? Math.round(revenue / (totalRooms * actual.length)) : null,
    lastYear:
      ly.length > 0
        ? {
            days: ly.length,
            soldRooms: lyRooms,
            revenue: Math.round(lyRevenue),
            occupancy: round3(lyRooms / (totalRooms * ly.length)),
            adr: lyRooms > 0 ? Math.round(lyRevenue / lyRooms) : null,
          }
        : null,
    dates: counted.map((d) => d.date),
  }
}

/** 曜日別パフォーマンスのデモ（前月以前は実績、当月以降は実績＋予約） */
export function mockDayOfWeekBreakdown(hotelId: string, year: number, month: number): DayOfWeekBreakdown {
  const { days, totalRooms } = mockDailyPerformance(hotelId, year, month)
  const dowOf = (date: string) => new Date(`${date}T00:00:00`).getDay()
  return {
    hotelId,
    year,
    month,
    days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
      const mine = days.filter((d) => dowOf(d.date) === dayOfWeek)
      return {
        dayOfWeek,
        isWeekend: mine.length > 0 && isMockWeekend(new Date(`${mine[0].date}T00:00:00`)),
        ...demoAggregatePerformance(mine, totalRooms),
      }
    }),
  }
}

/** 日のタイプ別パフォーマンスのデモ（日ごとの型は料金カレンダーのデモと同じ判定） */
export function mockDayTypeBreakdown(hotelId: string, year: number, month: number): DayTypeBreakdown {
  const { days, totalRooms } = mockDailyPerformance(hotelId, year, month)
  const today = startOfLocalDay(new Date())
  const groups = new Map<string, DailyPerformance["days"]>()
  let untypedDays = 0
  for (const d of days) {
    const stay = new Date(`${d.date}T00:00:00`)
    const type = d.actual?.soldRooms != null
      ? demoClassifyDay(stay, { lead: 0, otbRooms: d.actual.soldRooms, finalRooms: d.actual.soldRooms })
      : demoClassifyDay(stay, { lead: leadDays(stay, today), otbRooms: d.onHand?.soldRooms ?? null, predictedOccupancy: d.ai?.occupancy ?? null })
    if (!type) {
      untypedDays += 1
      continue
    }
    groups.set(type.name, [...(groups.get(type.name) ?? []), d])
  }
  return {
    hotelId,
    year,
    month,
    untypedDays,
    types: MOCK_DAY_TYPES.filter((t) => groups.has(t.name)).map((t) => ({
      dayType: t.name,
      model: t.model,
      ...demoAggregatePerformance(groups.get(t.name) ?? [], totalRooms),
    })),
  }
}

/** 月の予約の積み上がりのデモ（180日前 → 結果。まだ来ていない残日数は出さない） */
export function mockMonthPace(hotelId: string, year: number, month: number): MonthPace {
  const totalRooms = MOCK_HOTEL.totalRooms
  const { calendar } = mockPricingCalendar(hotelId, year, month)
  const curves = calendar.map((day) => demoDayCurve(new Date(`${day.date}T00:00:00`), day.actualOccupancy ?? day.predictedOccupancy ?? 0.7))
  const lastDay = new Date(year, month - 1, calendar.length)
  const minLead = Math.max(0, leadDays(lastDay))
  const capacity = totalRooms * calendar.length
  const points = []
  // 予約は積み上がるだけ（日ごとに、それまでの最大を下回らない）
  const ownMax = curves.map(() => 0)
  const lyMax = curves.map(() => 0)
  for (let lead = 180; lead >= minLead; lead--) {
    let rooms = 0
    let lastYearRooms = 0
    curves.forEach((curve, i) => {
      const [own, ly] = curve.at(lead)
      ownMax[i] = Math.max(ownMax[i], own)
      lyMax[i] = Math.max(lyMax[i], ly)
      rooms += ownMax[i]
      lastYearRooms += lyMax[i]
    })
    points.push({
      daysBefore: lead,
      rooms,
      occupancy: Math.round((rooms / capacity) * 1000) / 1000,
      comparableRooms: rooms,
      lastYearRooms,
    })
  }
  const budget = mockBudgetValues(year, month)
  const aiRooms = calendar.reduce((sum, d) => sum + Math.round(totalRooms * (d.predictedOccupancy ?? 0)), 0)
  return {
    hotelId,
    year,
    month,
    totalRooms,
    days: calendar.length,
    budgetRooms: budget.budgetRooms ?? null,
    budgetOccupancy: budget.budgetRooms != null ? Math.round((budget.budgetRooms / capacity) * 1000) / 1000 : null,
    aiRooms,
    aiOccupancy: Math.round((aiRooms / capacity) * 1000) / 1000,
    points,
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
  const dateKey = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10)
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
        startDate: new Date(`${row.startDate}T00:00:00Z`),
        endDate: new Date(`${row.endDate}T00:00:00Z`),
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
