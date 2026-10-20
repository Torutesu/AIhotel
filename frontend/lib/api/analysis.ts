// 分析タブの内訳 API（#88）。index.ts の api オブジェクトに展開されるので、画面からは api.xxx で呼ぶ。

import { rawRequest, withDemoFallback } from "./client"
import { mockChannelBreakdown, mockRoomTypeBreakdown } from "./demo-data"
import { mockDailyPerformance, mockDayOfWeekBreakdown, mockDayTypeBreakdown, mockMonthPace } from "./demo-revenue"
import type { ChannelBreakdown, DailyPerformance, DayOfWeekBreakdown, DayTypeBreakdown, MonthPace, RoomTypeBreakdown } from "./types"

const monthQuery = (hotelId: string, year: number, month: number) =>
  `hotelId=${encodeURIComponent(hotelId)}&year=${year}&month=${month}`

export const analysisEndpoints = {
  /** チャネル別の実績（対象月。前月比つき） */
  channelBreakdown(hotelId: string, year: number, month: number): Promise<ChannelBreakdown> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/analysis/channels?${monthQuery(hotelId, year, month)}`),
      () => mockChannelBreakdown(hotelId, year, month)
    )
  },

  /** 部屋タイプ別の実績（対象月） */
  roomTypeBreakdown(hotelId: string, year: number, month: number): Promise<RoomTypeBreakdown> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/analysis/room-types?${monthQuery(hotelId, year, month)}`),
      () => mockRoomTypeBreakdown(hotelId, year, month)
    )
  },

  /** 曜日別パフォーマンス（対象月。前月以前は実績、当月以降は実績＋予約。週末はホテルの週末定義） */
  dayOfWeekBreakdown(hotelId: string, year: number, month: number): Promise<DayOfWeekBreakdown> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/analysis/day-of-week?${monthQuery(hotelId, year, month)}`),
      () => mockDayOfWeekBreakdown(hotelId, year, month)
    )
  },

  /** 日のタイプ別パフォーマンス（平日A型など。曜日別と同じ項目） */
  dayTypeBreakdown(hotelId: string, year: number, month: number): Promise<DayTypeBreakdown> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/analysis/day-type?${monthQuery(hotelId, year, month)}`),
      () => mockDayTypeBreakdown(hotelId, year, month)
    )
  },

  /** 日別パフォーマンス（実績と、日割り予算・AI の予測・前年同曜日 — 2026-10） */
  dailyPerformance(hotelId: string, year: number, month: number): Promise<DailyPerformance> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/analysis/daily-performance?${monthQuery(hotelId, year, month)}`),
      () => mockDailyPerformance(hotelId, year, month)
    )
  },

  /** 月の予約の積み上がり（180日前 → 結果）と予算・AI の予測・前年同曜日 — 日別パフォーマンスの月のグラフ */
  monthPace(hotelId: string, year: number, month: number): Promise<MonthPace> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/analysis/month-pace?${monthQuery(hotelId, year, month)}`),
      () => mockMonthPace(hotelId, year, month)
    )
  },
}
