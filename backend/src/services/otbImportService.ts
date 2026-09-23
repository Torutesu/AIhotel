import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { todayJst } from '../lib/date.js'
import type { ImportOtbInput } from '../lib/validators.js'

// OTB（その時点の予約積上室数）の取り込み（#24 E2）。
// 「ある日の時点で、先の宿泊日に何室売れていたか」は後から作れないため、毎日1回取り込む。
// 取り込みは提供側が自動で行う（2026-09-23 決定）。手動アップロードと同じこの処理を、
// 運営のアカウントから定期的に呼び出す。
//
// BookingCurveData（宿泊日×残日数で1行）に upsert する。同じ日に2回取り込んだら上書き。
// 全行を検証してから1トランザクションで書く（#82 と同じ方針）。

const DAY_MS = 86_400_000

/** 行の検証（純関数） */
export function findOtbRowErrors(
  rows: ImportOtbInput['rows'],
  capturedDate: string,
  totalRooms: number
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = []
  const seen = new Map<string, number>()
  rows.forEach((row, index) => {
    const first = seen.get(row.stayDate)
    if (first !== undefined) {
      errors.push({ field: `rows.${index}.stayDate`, message: `宿泊日 ${row.stayDate} が ${first + 1} 行目と重複しています` })
    } else {
      seen.set(row.stayDate, index)
    }
    if (row.stayDate < capturedDate) {
      errors.push({
        field: `rows.${index}.stayDate`,
        message: `宿泊日 ${row.stayDate} が取込日 ${capturedDate} より前です（過去の宿泊日は日次実績として取り込んでください）`,
      })
    }
    if (row.roomsBooked > totalRooms) {
      errors.push({
        field: `rows.${index}.roomsBooked`,
        message: `予約室数 ${row.roomsBooked} がホテルの客室数 ${totalRooms} を超えています`,
      })
    }
  })
  return errors
}

export interface ImportOtbResult {
  dryRun: boolean
  capturedDate: string
  total: number
  created: number
  updated: number
  startDate: string
  endDate: string
  tenantId: string
}

export async function importOtbService(input: ImportOtbInput): Promise<ImportOtbResult> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: input.hotelId, isActive: true },
    select: { id: true, tenantId: true, totalRooms: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const capturedDate = input.capturedDate ?? todayJst().toISOString().slice(0, 10)
  const errors = findOtbRowErrors(input.rows, capturedDate, hotel.totalRooms)
  if (errors.length > 0) {
    throw new BadRequestError('取り込めない行があります。1行も取り込んでいません', errors)
  }

  const captured = new Date(`${capturedDate}T00:00:00Z`)
  const keyed = input.rows.map((row) => {
    const stayDate = new Date(`${row.stayDate}T00:00:00Z`)
    return { stayDate, daysBefore: Math.round((stayDate.getTime() - captured.getTime()) / DAY_MS), roomsBooked: row.roomsBooked }
  })
  const existing = await prisma.bookingCurveData.count({
    where: { hotelId: hotel.id, OR: keyed.map((k) => ({ stayDate: k.stayDate, daysBefore: k.daysBefore })) },
  })
  const sorted = input.rows.map((r) => r.stayDate).sort()

  const summary = {
    dryRun: Boolean(input.dryRun),
    capturedDate,
    total: input.rows.length,
    created: input.rows.length - existing,
    updated: existing,
    startDate: sorted[0],
    endDate: sorted[sorted.length - 1],
    tenantId: hotel.tenantId,
  }
  if (input.dryRun) return summary

  const capturedAt = new Date()
  await prisma.$transaction(
    async (tx) => {
      for (const k of keyed) {
        await tx.bookingCurveData.upsert({
          where: { hotelId_stayDate_daysBefore: { hotelId: hotel.id, stayDate: k.stayDate, daysBefore: k.daysBefore } },
          update: { roomsBooked: k.roomsBooked, capturedAt },
          create: { tenantId: hotel.tenantId, hotelId: hotel.id, stayDate: k.stayDate, daysBefore: k.daysBefore, roomsBooked: k.roomsBooked, capturedAt },
        })
      }
    },
    { timeout: 60_000 }
  )
  return summary
}
