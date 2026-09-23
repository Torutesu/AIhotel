// 分析タブの内訳 API（#88）。index.ts の api オブジェクトに展開されるので、画面からは api.xxx で呼ぶ。

import { rawRequest } from "./client"
import type { ChannelBreakdown, DayOfWeekBreakdown, RoomTypeBreakdown } from "./types"

const monthQuery = (hotelId: string, year: number, month: number) =>
  `hotelId=${encodeURIComponent(hotelId)}&year=${year}&month=${month}`

export const analysisEndpoints = {
  /** チャネル別の実績（対象月。前月比つき） */
  channelBreakdown(hotelId: string, year: number, month: number): Promise<ChannelBreakdown> {
    return rawRequest(`/api/v1/analysis/channels?${monthQuery(hotelId, year, month)}`)
  },

  /** 部屋タイプ別の実績（対象月） */
  roomTypeBreakdown(hotelId: string, year: number, month: number): Promise<RoomTypeBreakdown> {
    return rawRequest(`/api/v1/analysis/room-types?${monthQuery(hotelId, year, month)}`)
  },

  /** 曜日別の実績（対象月。週末はホテルの週末定義） */
  dayOfWeekBreakdown(hotelId: string, year: number, month: number): Promise<DayOfWeekBreakdown> {
    return rawRequest(`/api/v1/analysis/day-of-week?${monthQuery(hotelId, year, month)}`)
  },
}
