// デモモード用のサンプルデータ（#91 で lib/api.ts から分割）。
// NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われ、
// 本番ビルドではツリーシェイクで成果物から消える（scripts/verify-demo-mode.mjs で検証）。

import type {
  Event as HotelEvent,
  PriceRank,
} from "@shared/types"
import { parseWeekendDays } from "@/lib/date"
import { createSeededRandom } from "@/lib/format"
import {
  MOCK_HOTEL_ID,
  MOCK_HOTEL,
} from "./client"
import {
  ComparisonAxis,
  ActualSummary,
  DashboardKpi,
  AlertItem,
  AiSummary,
  PricingCalendarDay,
  PricingCalendar,
  PricingStrategy,
  BookingCurve,
  CompetitorPrices,
  MonthlyTrend,
  CompetitorAnalysis,
} from "./types"

// ---- Dev-only demo data (ダッシュボード/ダイナミックプライシング画面用) ----
// バックエンドの seed データと近い分布になるよう簡易な季節・曜日変動を再現しているだけの
// ダミー値。実データではない。

export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function isMockWeekend(date: Date): boolean {
  return parseWeekendDays(MOCK_HOTEL.weekendDays).includes(date.getDay())
}

export function mockSeasonBoost(month: number): number {
  return 1 + 0.1 * Math.sin(((month + 1) / 12) * 2 * Math.PI)
}

export function mockDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function mockRankToPrice1P(rank: number): number {
  const ratio = (rank - 1) / 39
  return Math.round(6500 + ratio * 23500)
}

export function mockDashboardKpi(hotelId: string, year: number, month: number): DashboardKpi {
  const totalRooms = MOCK_HOTEL.totalRooms
  const numDays = mockDaysInMonth(year, month)
  const today = new Date()
  const rng = createSeededRandom(year * 100 + month)
  const boost = mockSeasonBoost(month)

  let totalRevenue = 0
  let soldRoomsSum = 0
  let guestsSum = 0
  let actualDays = 0
  const dailyTrend: DashboardKpi["dailyTrend"] = []

  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d)
    const weekend = isMockWeekend(date)
    const occupancy = Math.min(1, Math.max(0.3, (weekend ? 0.9 : 0.72) * boost + (rng() - 0.5) * 0.12))
    const adr = Math.round((weekend ? 23000 : 16500) * boost + (rng() - 0.5) * 1000)
    const isActual = date <= today
    const soldRooms = Math.round(occupancy * totalRooms)

    if (isActual) {
      actualDays += 1
      totalRevenue += soldRooms * adr
      soldRoomsSum += soldRooms
      guestsSum += Math.round(soldRooms * (1.3 + rng() * 0.4))
    }

    dailyTrend.push({
      date: toLocalDateStr(date),
      occupancy: isActual ? Number(occupancy.toFixed(3)) : null,
      adr: isActual ? adr : null,
      predictedOccupancy: Number(Math.min(1, occupancy + (rng() - 0.5) * 0.06).toFixed(3)),
      predictedAdr: Math.round(adr * (1 + (rng() - 0.5) * 0.05)),
      // 前年同月同日の実績（モックでは当年から数%低い水準として生成）
      lastYearOccupancy: Number(Math.max(0.2, occupancy * (0.93 + rng() * 0.06)).toFixed(3)),
      lastYearAdr: Math.round(adr * (0.9 + rng() * 0.06)),
      isActual,
    })
  }

  const adr = soldRoomsSum > 0 ? Math.round(totalRevenue / soldRoomsSum) : 0
  const occupancyRate = actualDays > 0 ? soldRoomsSum / (totalRooms * actualDays) : 0
  const revPar = actualDays > 0 ? totalRevenue / (totalRooms * actualDays) : 0
  // DOR = 宿泊人数 / 販売室数（1室あたり平均利用人数）
  const dor = soldRoomsSum > 0 ? Math.round((guestsSum / soldRoomsSum) * 100) / 100 : 0
  const guestUnitPrice = guestsSum > 0 ? Math.round(totalRevenue / guestsSum) : 0

  const budgetOccupancy = 0.78
  const budgetAdr = 18500
  const budgetRevenue = Math.round(budgetAdr * budgetOccupancy * totalRooms * numDays)
  const budgetRevenueToDate = actualDays > 0 ? Math.round((budgetRevenue / numDays) * actualDays) : null
  const lastYearRevenue = Math.round(budgetRevenue * 0.95)
  const lastYearAdr = 17200
  const lastYearOccupancy = 0.74

  const mockRatio = (actual: number | null, target: number | null): number | null =>
    actual == null || target == null || target === 0 ? null : Number((actual / target).toFixed(3))

  const mockAxis = (
    budgetRev: number | null,
    lastYearRev: number | null,
    actualRevenue: number,
    actualAdr: number,
    actualOccupancy: number
  ): ComparisonAxis => ({
    budgetRevenue: budgetRev,
    budgetRevenueRatio: mockRatio(actualRevenue, budgetRev),
    budgetAdr,
    budgetAdrRatio: mockRatio(actualAdr, budgetAdr),
    budgetOccupancy,
    budgetOccupancyRatio: mockRatio(actualOccupancy, budgetOccupancy),
    lastYearRevenue: lastYearRev,
    lastYearRevenueRatio: mockRatio(actualRevenue, lastYearRev),
    lastYearAdr,
    lastYearAdrRatio: mockRatio(actualAdr, lastYearAdr),
    lastYearOccupancy,
    lastYearOccupancyRatio: mockRatio(actualOccupancy, lastYearOccupancy),
  })

  // 年度累計（4月始まり）のモック: 経過月数ぶんを当月実績から外挿する
  const fiscalStartYear = month >= 4 ? year : year - 1
  const elapsedFiscalMonths = month >= 4 ? month - 3 : month + 9
  const fiscalRevenue = Math.round(totalRevenue * elapsedFiscalMonths * 0.98)
  const fiscalBudgetRevenue = Math.round((budgetRevenueToDate ?? 0) * elapsedFiscalMonths)
  const fiscalLastYearRevenue = Math.round(fiscalBudgetRevenue * 0.95)
  const fiscalSoldRooms = soldRoomsSum * elapsedFiscalMonths
  const fiscalGuests = guestsSum * elapsedFiscalMonths
  const fiscalAdr = fiscalSoldRooms > 0 ? Math.round(fiscalRevenue / fiscalSoldRooms) : 0

  const monthSummary: ActualSummary = {
    roomRevenue: Math.round(totalRevenue),
    soldRooms: soldRoomsSum,
    adr,
    occupancyRate: Number(occupancyRate.toFixed(3)),
    revPar: Math.round(revPar),
    guests: guestsSum,
    dor,
    guestUnitPrice,
    actualDays,
  }

  return {
    hotelId,
    year,
    month,
    summary: monthSummary,
    comparison:
      actualDays > 0 && budgetRevenueToDate
        ? {
            budgetRevenue,
            budgetRevenueToDate,
            budgetRatioToDate: Number((totalRevenue / budgetRevenueToDate).toFixed(3)),
            budgetAdr,
            budgetOccupancy,
            lastYearRevenue,
            lastYearRatio: Number((totalRevenue / (lastYearRevenue * (actualDays / numDays))).toFixed(3)),
            lastYearAdr,
            lastYearOccupancy,
            toDate: mockAxis(
              budgetRevenueToDate,
              Math.round(lastYearRevenue * (actualDays / numDays)),
              totalRevenue,
              adr,
              occupancyRate
            ),
            cumulative: mockAxis(budgetRevenue, lastYearRevenue, totalRevenue, adr, occupancyRate),
            fiscalYear: mockAxis(
              fiscalBudgetRevenue,
              fiscalLastYearRevenue,
              fiscalRevenue,
              fiscalAdr,
              occupancyRate
            ),
            fiscalYearLabel: `${fiscalStartYear}年度（4月〜${month}月）`,
            actualSummary: {
              toDate: monthSummary,
              cumulative: monthSummary,
              fiscalYear: {
                roomRevenue: fiscalRevenue,
                soldRooms: fiscalSoldRooms,
                adr: fiscalAdr,
                occupancyRate: Number(occupancyRate.toFixed(3)),
                revPar: Math.round(revPar),
                guests: fiscalGuests,
                dor: fiscalSoldRooms > 0 ? Number((fiscalGuests / fiscalSoldRooms).toFixed(2)) : 0,
                guestUnitPrice: fiscalGuests > 0 ? Math.round(fiscalRevenue / fiscalGuests) : 0,
                actualDays: actualDays * elapsedFiscalMonths,
              },
            },
          }
        : null,
    dailyTrend,
    simulation: {
      projectedRevenue: Math.round(budgetAdr * 1.02 * 0.81 * totalRooms * numDays),
      projectedAdr: Math.round(budgetAdr * 1.02),
      projectedOccupancy: 0.81,
      projectedRevPar: Math.round(budgetAdr * 1.02 * 0.81),
    },
  }
}

export function mockAlerts(minLevel?: number): AlertItem[] {
  const today = new Date()
  const plusDays = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return toLocalDateStr(d)
  }
  const all: AlertItem[] = [
    {
      id: "mock-alert-1",
      severity: "RED",
      level: 5,
      title: "稼働率が予算を大幅に下回っています",
      message: "来週火曜の予約積上が予算比 -18pt です。価格ランクの引き下げを検討してください。",
      linkTab: "pricing",
      targetDate: plusDays(4),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-2",
      severity: "YELLOW",
      level: 4,
      title: "競合価格との乖離が拡大",
      message: "今週末の自社価格が競合水準より 12% 高くなっています。経過観察してください。",
      linkTab: "daily",
      targetDate: plusDays(2),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-3",
      severity: "YELLOW",
      level: 3,
      title: "OTA別の予約構成比に変化",
      message: "公式サイト経由の構成比が前月比 -4pt です。チャネル分析で推移を確認してください。",
      linkTab: "analysis",
      targetDate: plusDays(7),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-4",
      severity: "YELLOW",
      level: 2,
      title: "翌月の予算未登録",
      message: "翌月の予算データが未登録です。設定画面から登録してください。",
      linkTab: "settings",
      targetDate: null,
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-5",
      severity: "YELLOW",
      level: 1,
      title: "料金ランクの見直し推奨",
      message: "直近30日で未使用の料金ランクが3件あります。マスタ整理を検討してください。",
      linkTab: "settings",
      targetDate: null,
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
  ]
  return minLevel != null ? all.filter((a) => a.level >= minLevel) : all
}

export function mockAiSummary(section?: string): AiSummary {
  return {
    id: "mock-ai-summary",
    section: section ?? "dashboard-summary",
    content:
      "今月の稼働率は予算比 +2.1pt と好調に推移しています。週末（金・土）のADRは前年比 +6% で、" +
      "特に土曜日は満室に近い水準です。一方、平日火曜・水曜の稼働が予算を下回っており、" +
      "平日限定プランまたは料金ランク引き下げの検討を推奨します。",
    generatedAt: new Date().toISOString(),
  }
}

export function mockPricingCalendar(hotelId: string, year: number, month: number): PricingCalendar {
  const numDays = mockDaysInMonth(year, month)
  const today = new Date()
  const rng = createSeededRandom(year * 100 + month + 7)
  const boost = mockSeasonBoost(month)
  const calendar: PricingCalendarDay[] = []

  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d)
    const weekend = isMockWeekend(date)
    const isPast = date < today
    const predictedOccupancy = Number(
      Math.min(1, Math.max(0.3, (weekend ? 0.9 : 0.72) * boost + (rng() - 0.5) * 0.1)).toFixed(3)
    )
    const predictedAdr = Math.round((weekend ? 24000 : 17000) * boost)
    const recommendedRank = Math.min(40, Math.max(1, Math.round(predictedOccupancy * 40)))
    const price1P = mockRankToPrice1P(recommendedRank)
    const demandLevel: PricingCalendarDay["demandLevel"] =
      predictedOccupancy > 0.9 ? "A" : predictedOccupancy > 0.8 ? "B" : predictedOccupancy > 0.65 ? "C" : predictedOccupancy > 0.5 ? "D" : "E"
    const competitorMedianPrice = Math.round((weekend ? 22000 : 15500) * boost * (0.95 + rng() * 0.15))

    calendar.push({
      date: toLocalDateStr(date),
      demandLevel,
      recommendedRank,
      recommendedPrice: price1P,
      rankLabel: `R${String(recommendedRank).padStart(2, "0")}`,
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
      predictedOccupancy,
      predictedAdr,
      actualOccupancy: isPast ? Number(Math.min(1, predictedOccupancy + (rng() - 0.5) * 0.1).toFixed(3)) : null,
      actualAdr: isPast ? Math.round(predictedAdr * (1 + (rng() - 0.5) * 0.06)) : null,
      competitorMedianPrice,
      competitorMinPrice: Math.round(competitorMedianPrice * 0.88),
      competitorMaxPrice: Math.round(competitorMedianPrice * 1.14),
      confidence: Number((0.7 + rng() * 0.25).toFixed(2)),
    })
  }

  return { hotelId, year, month, calendar }
}

/** 中央値（デモデータ生成用） */
export function mockMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

// 競合ホテル（seedと同等の3社構成）
export const MOCK_COMPETITOR_DEFS = [
  { id: "mock-comp-1", name: "コンペティターホテルA", category: "アップスケール", factor: 1.08 },
  { id: "mock-comp-2", name: "コンペティターホテルB", category: "ミッドスケール", factor: 0.94 },
  { id: "mock-comp-3", name: "コンペティターホテルC", category: "アップスケール", factor: 1.02 },
]

export function eachMockDate(startDate: string, endDate: string): Date[] {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const dates: Date[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d))
  }
  return dates
}

export function mockBookingCurve(hotelId: string, date: string): BookingCurve {
  const stay = new Date(date)
  const totalRooms = MOCK_HOTEL.totalRooms
  const rng = createSeededRandom(stay.getFullYear() * 10000 + (stay.getMonth() + 1) * 100 + stay.getDate())
  const weekend = isMockWeekend(stay)
  const finalOccupancy = Math.min(0.98, (weekend ? 0.92 : 0.74) + (rng() - 0.5) * 0.1)

  // 宿泊日までの日数が減るほど積み上がる（右肩上がり — F-DAILY-01）
  const daysBeforeList = [90, 60, 45, 30, 21, 14, 10, 7, 5, 3, 2, 1, 0]
  const points = daysBeforeList.map((daysBefore) => {
    const progress = Math.pow(1 - daysBefore / 90, 1.6)
    const occupancy = Number((finalOccupancy * progress).toFixed(3))
    return {
      daysBefore,
      roomsBooked: Math.round(totalRooms * occupancy),
      occupancy,
    }
  })

  return { hotelId, stayDate: date, totalRooms, points }
}

export function mockCompetitorPrices(hotelId: string, startDate: string, endDate: string): CompetitorPrices {
  const dates = eachMockDate(startDate, endDate)
  const today = new Date()

  const basePrice = (date: Date, rng: () => number) => {
    const weekend = isMockWeekend(date)
    return Math.round((weekend ? 23000 : 16500) * mockSeasonBoost(date.getMonth() + 1) * (0.97 + rng() * 0.08))
  }

  const ownPrices = dates.map((date) => {
    const rng = createSeededRandom(date.getTime() / 86400000)
    const price1P = basePrice(date, rng)
    return {
      date: toLocalDateStr(date),
      price: price1P,
      isActual: date <= today,
      // 利用人数別の自館価格（料金ランク相当。1名を基準に2名・3名を積み上げる）
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
    }
  })

  const competitors = MOCK_COMPETITOR_DEFS.map((comp, ci) => ({
    id: comp.id,
    name: comp.name,
    category: comp.category,
    prices: dates.map((date) => {
      const rng = createSeededRandom(date.getTime() / 86400000 + ci * 977)
      const price1P = Math.round(basePrice(date, rng) * comp.factor)
      return {
        date: toLocalDateStr(date),
        price1P,
        price2P: Math.round(price1P * 1.38),
        price3P: Math.round(price1P * 1.75),
        reliability: rng() > 0.15 ? "HIGH" : "MEDIUM",
      }
    }),
  }))

  return { hotelId, startDate, endDate, ownPrices, competitors }
}

export function mockMonthlyTrend(hotelId: string, year: number): MonthlyTrend {
  const today = new Date()
  const totalRooms = MOCK_HOTEL.totalRooms

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const rng = createSeededRandom(year * 100 + month)
    const boost = mockSeasonBoost(month)
    const days = mockDaysInMonth(year, month)
    const hasActuals = new Date(year, month - 1, 1) <= today

    const occupancy = Number(Math.min(0.97, 0.76 * boost + (rng() - 0.5) * 0.08).toFixed(3))
    const adr = Math.round(18000 * boost * (0.97 + rng() * 0.06))
    const soldRooms = Math.round(totalRooms * days * occupancy)
    const revenue = soldRooms * adr
    const guests = Math.round(soldRooms * 1.5)

    return {
      month,
      revenue: hasActuals ? revenue : 0,
      soldRooms: hasActuals ? soldRooms : 0,
      guests: hasActuals ? guests : 0,
      adr: hasActuals ? adr : null,
      occupancy: hasActuals ? occupancy : null,
      revPar: hasActuals ? Math.round(adr * occupancy) : null,
      budgetRevenue: Math.round(revenue * 0.97),
      lastYearRevenue: Math.round(revenue * 0.93),
      hasActuals,
    }
  })

  return { hotelId, year, months }
}

export function mockCompetitorAnalysis(
  hotelId: string,
  startDate: string,
  endDate: string
): CompetitorAnalysis {
  const prices = mockCompetitorPrices(hotelId, startDate, endDate)

  const competitors = prices.competitors.map((comp) => {
    const values = comp.prices
      .map((p) => p.price1P)
      .filter((v): v is number => v != null)
    return {
      id: comp.id,
      name: comp.name,
      category: comp.category,
      sampleSize: values.length,
      minPrice: values.length > 0 ? Math.min(...values) : null,
      maxPrice: values.length > 0 ? Math.max(...values) : null,
      medianPrice: mockMedian(values),
    }
  })

  return { hotelId, startDate, endDate, competitors }
}

// 料金ランク40段階（F-SET-02）。更新はメモリ上に保持してUI操作を確認できるようにする
export let mockPriceRanks: PriceRank[] | null = null

export function getMockPriceRanks(hotelId: string): PriceRank[] {
  if (mockPriceRanks) return mockPriceRanks
  mockPriceRanks = Array.from({ length: 40 }, (_, i) => {
    const rank = i + 1
    const price1P = mockRankToPrice1P(rank)
    return {
      id: `mock-rank-${rank}`,
      hotelId,
      rank,
      label: `R${String(rank).padStart(2, "0")}`,
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
      price4P: Math.round(price1P * 2.1),
      isActive: true,
    } as PriceRank
  })
  return mockPriceRanks
}

export let mockStrategy: PricingStrategy = {
  id: "mock-strategy",
  hotelId: MOCK_HOTEL_ID,
  weightOccupancy: 40,
  weightAdr: 40,
  weightCompetitor: 20,
}

export let mockEvents: HotelEvent[] | null = null

export function getMockEvents(hotelId: string): HotelEvent[] {
  if (mockEvents) return mockEvents
  const today = new Date()
  mockEvents = [
    {
      id: "mock-event-1",
      hotelId,
      name: "地域花火大会",
      type: "festival",
      startDate: new Date(today.getFullYear(), today.getMonth(), 15),
      endDate: new Date(today.getFullYear(), today.getMonth(), 15),
      location: "近隣河川敷",
      expectedImpact: "high",
      description: "周辺ホテルの需要増加が見込まれます。",
    },
  ]
  return mockEvents
}

/** デモモードで保存した価格戦略を差し替える（ES モジュールの import は再代入できないため関数で行う） */
export function setMockStrategy(next: PricingStrategy): PricingStrategy {
  mockStrategy = next
  return mockStrategy
}

/** デモモードで編集したイベント一覧を差し替える */
export function setMockEvents(next: HotelEvent[]): HotelEvent[] {
  mockEvents = next
  return mockEvents
}
