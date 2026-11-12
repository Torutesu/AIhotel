// デモモード用の予約動向・利用人数別（D-13）。NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われる。
// 形は GET /analysis/booking-windows・/analysis/guest-counts と同じ。数値は demo-reservations-sample.ts のサンプル

import { buildPeriodData } from "./demo-reservations-sample"
import type { BookingWindows, GuestCounts } from "./types"

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
