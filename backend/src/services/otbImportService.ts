import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { todayJst } from '../lib/date.js'
import type { ImportBookingCurveInput, ImportOtbInput, ImportReservationsInput } from '../lib/validators.js'
import { reservationsToCurve } from './imports/reservationCurve.js'
import {
  commitImport,
  loadImportHotel,
  rejectRows,
  RowErrors,
  toDate,
  type ImportHotel,
  type ImportSummary,
  type RowError,
} from './imports/importKit.js'

// OTB（その時点の予約積上室数）の取り込み（#24 E2）。
// 「ある日の時点で、先の宿泊日に何室売れていたか」は後から作れないため、毎日1回取り込む。
// 取り込みは提供側が自動で行う（2026-09-23 決定）。手動アップロードと同じこの処理を、
// 運営のアカウントから定期的に呼び出す。
//
// BookingCurveData（宿泊日×残日数で1行）に upsert する。同じ日に2回取り込んだら上書き。
// 全行を検証してから1トランザクションで書く（#82 と同じ方針）。

const DAY_MS = 86_400_000

/** 行の検証（純関数） */
export function findOtbRowErrors(rows: ImportOtbInput['rows'], capturedDate: string, totalRooms: number): RowError[] {
  const errors = new RowErrors()
  rows.forEach((row, index) => {
    errors.duplicate(index, 'stayDate', row.stayDate, `宿泊日 ${row.stayDate}`)
    if (row.stayDate < capturedDate) {
      errors.add(
        index,
        'stayDate',
        `宿泊日 ${row.stayDate} が取込日 ${capturedDate} より前です（過去の宿泊日は日次実績として取り込んでください）`
      )
    }
    if (row.roomsBooked > totalRooms) {
      errors.add(index, 'roomsBooked', `予約室数 ${row.roomsBooked} がホテルの客室数 ${totalRooms} を超えています`)
    }
  })
  return errors.list
}

export type ImportOtbResult = ImportSummary & { capturedDate: string }

export async function importOtbService(input: ImportOtbInput): Promise<ImportOtbResult> {
  const hotel = await loadImportHotel(input.hotelId)
  const capturedDate = input.capturedDate ?? todayJst().toISOString().slice(0, 10)
  rejectRows(findOtbRowErrors(input.rows, capturedDate, hotel.totalRooms))

  const captured = toDate(capturedDate)
  const keyed = input.rows.map((row) => {
    const stayDate = toDate(row.stayDate)
    return { stayDate, daysBefore: Math.round((stayDate.getTime() - captured.getTime()) / DAY_MS), roomsBooked: row.roomsBooked }
  })
  const capturedAt = new Date()
  return commitImport({
    hotel,
    dryRun: input.dryRun,
    dates: input.rows.map((r) => r.stayDate),
    extra: { capturedDate },
    existing: await prisma.bookingCurveData.count({
      where: { hotelId: hotel.id, OR: keyed.map((k) => ({ stayDate: k.stayDate, daysBefore: k.daysBefore })) },
    }),
    write: (tx) => upsertCurvePoints(tx, hotel, keyed, () => capturedAt),
  })
}

type CurvePoint = { stayDate: Date; daysBefore: number; roomsBooked: number }

async function upsertCurvePoints(
  tx: Prisma.TransactionClient,
  hotel: ImportHotel,
  points: CurvePoint[],
  capturedAtOf: (p: CurvePoint) => Date
) {
  for (const k of points) {
    const capturedAt = capturedAtOf(k)
    await tx.bookingCurveData.upsert({
      where: { hotelId_stayDate_daysBefore: { hotelId: hotel.id, stayDate: k.stayDate, daysBefore: k.daysBefore } },
      update: { roomsBooked: k.roomsBooked, capturedAt },
      create: { tenantId: hotel.tenantId, hotelId: hotel.id, stayDate: k.stayDate, daysBefore: k.daysBefore, roomsBooked: k.roomsBooked, capturedAt },
    })
  }
}

// ======================================
// 過去の予約積上（ブッキングカーブ）の一括取り込み（D-13 — 立ち上げ）
// ======================================
//
// 導入時に、PMS・サイトコントローラーに残っている過去の予約の推移（宿泊日 × 残日数 → 予約室数）をまとめて入れる。
// 毎日の OTB の取り込みでは過去にさかのぼれないため、これが無いとピックアップ型（dayPattern.ts）・前年ペース（pace.ts）・
// 似た日の予測が、取り込みを始めてから1年たつまで働かない。
// 1行は「宿泊日・残日数（または取得日）・予約室数」。取得した時点（capturedAt）は宿泊日 − 残日数にする（取り込んだ時刻にはしない —
// 予約の取り込みが止まっていないかの判定を、過去の取り込みでごまかさないため）。

export function findBookingCurveRowErrors(rows: ImportBookingCurveInput['rows'], totalRooms: number): RowError[] {
  const errors = new RowErrors()
  rows.forEach((row, index) => {
    const daysBefore = curveDaysBefore(row)
    if (daysBefore == null) {
      errors.add(index, 'daysBefore', '残日数か取得日のどちらかを入れてください')
      return
    }
    if (daysBefore < 0) errors.add(index, 'capturedDate', `取得日 ${row.capturedDate} が宿泊日 ${row.stayDate} より後です`)
    if (daysBefore > MAX_CURVE_DAYS_BEFORE) errors.add(index, 'daysBefore', `残日数は ${MAX_CURVE_DAYS_BEFORE} 日までです`)
    errors.duplicate(index, 'stayDate', `${row.stayDate}:${daysBefore}`, `宿泊日 ${row.stayDate}・残日数 ${daysBefore}`)
    if (row.roomsBooked > totalRooms) {
      errors.add(index, 'roomsBooked', `予約室数 ${row.roomsBooked} がホテルの客室数 ${totalRooms} を超えています`)
    }
  })
  return errors.list
}

export const MAX_CURVE_DAYS_BEFORE = 540

function curveDaysBefore(row: ImportBookingCurveInput['rows'][number]): number | null {
  if (row.daysBefore != null) return row.daysBefore
  if (!row.capturedDate) return null
  return Math.round((toDate(row.stayDate).getTime() - toDate(row.capturedDate).getTime()) / DAY_MS)
}

export async function importBookingCurveService(input: ImportBookingCurveInput): Promise<ImportSummary> {
  const hotel = await loadImportHotel(input.hotelId)
  rejectRows(findBookingCurveRowErrors(input.rows, hotel.totalRooms))
  const points = input.rows.map((row) => ({
    stayDate: toDate(row.stayDate),
    daysBefore: curveDaysBefore(row) as number,
    roomsBooked: row.roomsBooked,
  }))
  return commitImport({
    hotel,
    dryRun: input.dryRun,
    dates: input.rows.map((r) => r.stayDate),
    existing: await prisma.bookingCurveData.count({
      where: { hotelId: hotel.id, OR: points.map((p) => ({ stayDate: p.stayDate, daysBefore: p.daysBefore })) },
    }),
    write: (tx) => upsertCurvePoints(tx, hotel, points, (p) => new Date(p.stayDate.getTime() - p.daysBefore * DAY_MS)),
  })
}

// ======================================
// 予約明細から作る（D-13 — 過去の予約の推移を入れる推奨の方法）
// ======================================

export function findReservationRowErrors(rows: ImportReservationsInput['rows'], totalRooms: number): RowError[] {
  const errors = new RowErrors()
  rows.forEach((row, index) => {
    if (row.bookedDate > row.checkInDate) errors.add(index, 'bookedDate', `予約日 ${row.bookedDate} がチェックイン日 ${row.checkInDate} より後です`)
    if (row.cancelledDate && row.cancelledDate < row.bookedDate) errors.add(index, 'cancelledDate', `取消日 ${row.cancelledDate} が予約日より前です`)
    if (row.rooms > totalRooms) errors.add(index, 'rooms', `室数 ${row.rooms} がホテルの客室数 ${totalRooms} を超えています`)
  })
  return errors.list
}

export async function importReservationsService(input: ImportReservationsInput): Promise<ImportSummary & { reservations: number }> {
  const hotel = await loadImportHotel(input.hotelId)
  rejectRows(findReservationRowErrors(input.rows, hotel.totalRooms))
  const curve = reservationsToCurve(input.rows, input.stayFrom, input.stayTo)
  if (curve.length === 0) rejectRows([{ field: 'stayFrom', message: '指定した宿泊日の範囲に、作れる予約の推移がありません（予約日が宿泊日より後の明細しかない）' }])
  const over = curve.find((p) => p.roomsBooked > hotel.totalRooms)
  if (over) {
    rejectRows([{ field: 'rows', message: `宿泊日 ${over.stayDate} の${over.daysBefore}日前の予約が ${over.roomsBooked} 室で、客室数を超えます（重複した明細が無いか確かめてください）` }])
  }
  const points = curve.map((p) => ({ stayDate: toDate(p.stayDate), daysBefore: p.daysBefore, roomsBooked: p.roomsBooked }))
  return commitImport({
    hotel,
    dryRun: input.dryRun,
    dates: curve.map((p) => p.stayDate),
    extra: { reservations: input.rows.length },
    existing: points.length === 0 ? 0 : await prisma.bookingCurveData.count({
      where: { hotelId: hotel.id, OR: points.map((p) => ({ stayDate: p.stayDate, daysBefore: p.daysBefore })) },
    }),
    write: async (tx) => {
      await upsertCurvePoints(tx, hotel, points, (p) => new Date(p.stayDate.getTime() - p.daysBefore * DAY_MS))
      await replaceReservations(tx, hotel, input)
    },
  })
}

/**
 * 明細そのものも保存する（予約動向・利用人数別の集計 — D-13）。宿泊日の範囲にかかる既存の明細を消してから入れ直す
 * （取り込みは「その範囲の泊にかかる予約をすべて含める」約束なので、入れ替えで同じ結果になる）
 */
async function replaceReservations(tx: Prisma.TransactionClient, hotel: ImportHotel, input: ImportReservationsInput) {
  const from = toDate(input.stayFrom)
  const to = toDate(input.stayTo)
  // 範囲にかかる = チェックイン日 ≦ 範囲の終わり かつ 最終泊（チェックイン日 + 泊数 − 1）≧ 範囲の初め。泊数は最大60泊
  const candidates = await tx.reservation.findMany({
    where: { hotelId: hotel.id, checkInDate: { lte: to, gte: new Date(from.getTime() - 60 * DAY_MS) } },
    select: { id: true, checkInDate: true, nights: true },
  })
  const overlapping = candidates.filter((r) => r.checkInDate.getTime() + (r.nights - 1) * DAY_MS >= from.getTime()).map((r) => r.id)
  if (overlapping.length > 0) await tx.reservation.deleteMany({ where: { id: { in: overlapping } } })
  await tx.reservation.createMany({
    data: input.rows.map((r) => ({
      tenantId: hotel.tenantId,
      hotelId: hotel.id,
      reservationCode: r.reservationCode ?? null,
      bookedDate: toDate(r.bookedDate),
      checkInDate: toDate(r.checkInDate),
      nights: r.nights,
      rooms: r.rooms,
      guests: r.guests ?? null,
      revenue: r.revenue ?? null,
      channel: r.channel ?? null,
      cancelledDate: r.cancelledDate ? toDate(r.cancelledDate) : null,
    })),
  })
}
