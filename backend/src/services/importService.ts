// 予約明細の取込（Phase 4 の前段 / 現地テスト検証用）。
//
// 変換は lib/reservationImport.ts の純粋関数で行い、このファイルは永続化だけを担う。
// すべて upsert（DailyData=hotelId+date、OtaChannelData=hotelId+date+channel、
// BookingCurveData=hotelId+stayDate+daysBefore、DailyRoomData=dailyDataId+roomTypeId）なので
// 同じCSVを何度取り込んでも行は増えない（冪等）。

import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import {
  aggregateByChannel,
  aggregateByRoomType,
  aggregateDaily,
  reconstructBookingCurve,
  type ReservationRecord,
} from '../lib/reservationImport.js'

export interface ImportSummary {
  hotel: { id: string; name: string; totalRooms: number }
  /** 取り込んだ（または取り込む予定の）行数 */
  dailyRows: number
  channelRows: number
  roomTypeRows: number
  curveRows: number
  /** 宿泊日の範囲 */
  stayDateFrom: string | null
  stayDateTo: string | null
  /** CSVに現れた販売先名 */
  channels: string[]
  /** RoomType.code に一致しなかった室タイプコード（取り込まずに報告する） */
  unknownRoomTypeCodes: string[]
  /** 実際に書き込んだか */
  written: boolean
}

/**
 * 正規化済みの予約レコードを実績テーブルへ取り込む。
 *
 * @param params.asOf データを取得した日（これより未来のカーブ点は作らない）
 * @param params.dryRun true のとき集計結果だけ返して書き込まない（既定の運用）
 */
export async function importReservationDataService(params: {
  hotelId: string
  records: ReservationRecord[]
  asOf: Date
  maxDaysBefore?: number
  dryRun: boolean
}): Promise<ImportSummary> {
  const { hotelId, records, asOf, maxDaysBefore, dryRun } = params

  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { id: true, name: true, tenantId: true, totalRooms: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const daily = aggregateDaily(records, hotel.totalRooms)
  const channels = aggregateByChannel(records)
  const roomTypes = aggregateByRoomType(records)
  const curve = reconstructBookingCurve(records, { asOf, maxDaysBefore })

  const roomTypeRows = await prisma.roomType.findMany({
    where: { hotelId, isActive: true },
    select: { id: true, code: true },
  })
  const roomTypeIdByCode = new Map(roomTypeRows.map((rt) => [rt.code, rt.id]))
  const unknownRoomTypeCodes = [
    ...new Set(roomTypes.filter((r) => !roomTypeIdByCode.has(r.roomTypeCode)).map((r) => r.roomTypeCode)),
  ]

  const summary: ImportSummary = {
    hotel: { id: hotel.id, name: hotel.name, totalRooms: hotel.totalRooms },
    dailyRows: daily.length,
    channelRows: channels.length,
    roomTypeRows: roomTypes.filter((r) => roomTypeIdByCode.has(r.roomTypeCode)).length,
    curveRows: curve.length,
    stayDateFrom: daily.at(0)?.date.toISOString().slice(0, 10) ?? null,
    stayDateTo: daily.at(-1)?.date.toISOString().slice(0, 10) ?? null,
    channels: [...new Set(channels.map((c) => c.channel))].sort(),
    unknownRoomTypeCodes,
    written: false,
  }

  if (dryRun) return summary

  const tenantId = hotel.tenantId
  const dailyDataIdByDate = new Map<string, string>()

  // 日別実績（DailyData）。イベント情報や祝日フラグは既存値を壊さないよう更新対象に含めない
  for (const row of daily) {
    const saved = await prisma.dailyData.upsert({
      where: { hotelId_date: { hotelId, date: row.date } },
      update: {
        soldRooms: row.soldRooms,
        guests: row.guests,
        totalRevenue: row.totalRevenue,
        adr: row.adr,
        occupancy: row.occupancy,
        revPar: row.revPar,
      },
      create: {
        tenantId,
        hotelId,
        date: row.date,
        soldRooms: row.soldRooms,
        guests: row.guests,
        totalRevenue: row.totalRevenue,
        adr: row.adr,
        occupancy: row.occupancy,
        revPar: row.revPar,
      },
      select: { id: true, date: true },
    })
    dailyDataIdByDate.set(saved.date.toISOString().slice(0, 10), saved.id)
  }

  // 客室タイプ別（DailyRoomData）。マスタに無いコードは取り込まない
  for (const row of roomTypes) {
    const roomTypeId = roomTypeIdByCode.get(row.roomTypeCode)
    const dailyDataId = dailyDataIdByDate.get(row.date.toISOString().slice(0, 10))
    if (!roomTypeId || !dailyDataId) continue
    await prisma.dailyRoomData.upsert({
      where: { dailyDataId_roomTypeId: { dailyDataId, roomTypeId } },
      update: { soldRooms: row.soldRooms, revenue: row.revenue },
      create: { tenantId, dailyDataId, roomTypeId, soldRooms: row.soldRooms, revenue: row.revenue },
    })
  }

  // チャネル別（OtaChannelData）。campaignFlag は運用側で立てる値なので触らない
  for (const row of channels) {
    await prisma.otaChannelData.upsert({
      where: { hotelId_date_channel: { hotelId, date: row.date, channel: row.channel } },
      update: { roomsSold: row.roomsSold, revenue: row.revenue, adr: row.adr },
      create: {
        tenantId,
        hotelId,
        date: row.date,
        channel: row.channel,
        roomsSold: row.roomsSold,
        revenue: row.revenue,
        adr: row.adr,
      },
    })
  }

  // ブッキングカーブ（BookingCurveData）
  for (const point of curve) {
    await prisma.bookingCurveData.upsert({
      where: {
        hotelId_stayDate_daysBefore: { hotelId, stayDate: point.stayDate, daysBefore: point.daysBefore },
      },
      update: { roomsBooked: point.roomsBooked },
      create: {
        tenantId,
        hotelId,
        stayDate: point.stayDate,
        daysBefore: point.daysBefore,
        roomsBooked: point.roomsBooked,
      },
    })
  }

  return { ...summary, written: true }
}
