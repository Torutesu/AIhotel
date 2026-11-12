// デモモード用の予約動向・利用人数別（D-13）。NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われる。
// 形は GET /analysis/booking-windows・/analysis/guest-counts と同じ。数値は demo-reservations-sample.ts のサンプル

import { buildPeriodData } from "./demo-reservations-sample"
import type { BookingWindows, GuestCounts, MonthCurve } from "./types"

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
