// デモモード用の予約動向・利用人数別（D-13）。NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われる。
// 形は GET /analysis/booking-windows・/analysis/guest-counts と同じ。数値は demo-reservations-sample.ts のサンプル

import { buildPeriodData } from "./demo-reservations-sample"
import type { BookingWindows, FreeAnalysis, FreeAnalysisAxis, FreeAnalysisMetric, GuestCounts, MonthCurve } from "./types"

const CURVE_LEADS = [180, 150, 120, 90, 75, 60, 45, 30, 21, 14, 7, 3, 1, 0]
const period = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`

export function mockBookingWindows(year: number, month: number): BookingWindows {
  const { bookingWindowData, cancelData } = buildPeriodData(period(year, month))
  return {
    bookings: bookingWindowData.map(({ dayType: _dayType, ...row }) => row),
    cancels: cancelData,
    reservations: 1200,
  }
}

export function mockGuestCounts(year: number, month: number): GuestCounts {
  const { guestCountData } = buildPeriodData(period(year, month))
  return {
    segments: guestCountData.map((g, i) => ({
      key: g.guestCount,
      name: g.guestCount,
      soldRooms: g.soldRooms,
      occupancy: g.occupancy,
      adr: g.adr,
      guestUnitPrice: g.guestUnitPrice,
      revenue: g.revenue,
      revenueShare: g.revenueShare,
      roomsShare: g.roomsShare,
      dor: g.dor,
      avgNights: g.avgNights,
      yoy: g.yoy,
      curve: CURVE_LEADS.map((lead) => {
        // 人数が多いほど早く入る（サンプル）
        const progress = Math.max(0, 1 - lead / (120 + i * 30))
        return { lead, rooms: Math.round(g.soldRooms * progress), lastYear: Math.round(g.soldRooms * 0.95 * Math.max(0, 1 - lead / (110 + i * 30))) }
      }),
    })),
    reservations: 1200,
  }
}

/** 月単位のブッキングカーブ（デモ。残月数ごとの積み上がり） */
export function mockMonthCurve(year: number, month: number): MonthCurve {
  const finals = [1800, 3800, 7000, 12000, 20000, 28000, 30200]
  const shares: Record<string, number> = { "1名": 0.52, "2名": 0.31, "3名": 0.12, "4名以上": 0.05 }
  return {
    year,
    month,
    totalRooms: 1000,
    budgetRooms: 29000,
    segmentNames: Object.keys(shares),
    reservations: 1200,
    points: finals.map((cumulative, i) => ({
      monthsBefore: 6 - i,
      cumulative,
      monthly: cumulative - (i === 0 ? 0 : finals[i - 1]),
      lastYearCumulative: Math.round(cumulative * 0.93),
      segments: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, Math.round(cumulative * v)])),
    })),
  }
}

const DEMO_AXIS_VALUES: Record<FreeAnalysisAxis, string[]> = {
  channel: ["公式サイト", "楽天トラベル", "じゃらん", "一休.com", "その他"],
  booking: ["当日", "1-3日前", "4-7日前", "8-14日前", "15-30日前", "31-60日前", "61-90日前"],
  guests: ["1名", "2名", "3名", "4名以上"],
  dayofweek: ["月", "火", "水", "木", "金", "土", "日"],
  date: Array.from({ length: 14 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`),
}
const DEMO_METRIC_RANGE: Record<FreeAnalysisMetric, [number, number]> = {
  rooms: [10, 50],
  occupancy: [50, 100],
  adr: [15000, 30000],
  revpar: [10000, 25000],
  revenue: [200000, 500000],
  bookings: [10, 30],
}

/** フリー分析（デモ。軸と項目から決まる値） */
export function mockFreeAnalysis(
  year: number,
  month: number,
  axis1: FreeAnalysisAxis,
  axis2: Exclude<FreeAnalysisAxis, "date"> | null,
  metric: FreeAnalysisMetric,
): FreeAnalysis {
  const [min, max] = DEMO_METRIC_RANGE[metric]
  const axis1Values = DEMO_AXIS_VALUES[axis1]
  const axis2Values = axis2 ? DEMO_AXIS_VALUES[axis2] : []
  const rows = axis1Values.flatMap((a, i) =>
    (axis2 ? axis2Values : [null]).map((b, j) => {
      const seed = ((i + 1) * 37 + (j + 1) * 11 + axis1.length) % 100
      const value = min + ((max - min) * seed) / 100
      return { axis1: a, axis2: b, value: metric === "occupancy" ? Math.round(value * 10) / 10 : Math.round(value) }
    }),
  )
  return { year, month, axis1, axis2, metric, axis1Values, axis2Values, rows, reservations: 1200 }
}
