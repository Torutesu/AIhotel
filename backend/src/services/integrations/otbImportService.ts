// PMS/サイトコントローラー連携の器（docs/外部要因設計.md P2-11）。
// PMS からの OTB（予約積上室数）を BookingCurveData に取り込む。
//   - スナップショット形式: { stayDate, roomsBooked } を「今日時点」として取り込む（daysBefore は自動計算）
//   - 履歴形式: { stayDate, daysBefore, roomsBooked } を直接取り込む（過去のカーブを一括投入する用）
// CSV は controller 側でパースして同じ行形式に揃える。PMS ごとのコネクタは PmsConnector を実装して rows を作る
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'

export interface OtbRow {
  stayDate: Date
  roomsBooked: number
  /** 省略時は capturedAt（既定: 今日）からのリードタイムを使う */
  daysBefore?: number
}

export interface OtbImportResult {
  hotelId: string
  tenantId: string
  imported: number
  skipped: Array<{ stayDate: string; reason: string }>
  capturedAt: string
}

/**
 * PMS コネクタのインターフェース。将来 API 直結する場合はこれを実装して rows を返す。
 * 現在の実装は CSV/JSON の手動アップロード（controller）のみ
 */
export interface PmsConnector {
  name: string
  fetchOnTheBooks(hotelId: string, capturedAt: Date): Promise<OtbRow[]>
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export async function importOnTheBooksService(hotelId: string, rows: OtbRow[], capturedAt = new Date()): Promise<OtbImportResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { tenantId: true, totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const asOf = dateOnly(capturedAt)
  const skipped: OtbImportResult['skipped'] = []
  let imported = 0
  for (const row of rows) {
    const stayDate = dateOnly(row.stayDate)
    const daysBefore = row.daysBefore ?? Math.round((stayDate.getTime() - asOf.getTime()) / 86_400_000)
    const key = stayDate.toISOString().slice(0, 10)
    if (daysBefore < 0) {
      skipped.push({ stayDate: key, reason: '宿泊日が基準日より前です' })
      continue
    }
    if (row.roomsBooked < 0 || row.roomsBooked > hotel.totalRooms * 1.2) {
      skipped.push({ stayDate: key, reason: `室数 ${row.roomsBooked} が客室数（${hotel.totalRooms}）に対して不正です` })
      continue
    }
    await prisma.bookingCurveData.upsert({
      where: { hotelId_stayDate_daysBefore: { hotelId, stayDate, daysBefore } },
      update: { roomsBooked: row.roomsBooked, capturedAt },
      create: { hotelId, tenantId: hotel.tenantId, stayDate, daysBefore, roomsBooked: row.roomsBooked, capturedAt },
    })
    imported++
  }
  return { hotelId, tenantId: hotel.tenantId, imported, skipped, capturedAt: capturedAt.toISOString() }
}
