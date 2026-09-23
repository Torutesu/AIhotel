import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import type { ImportDailyDataInput } from '../lib/validators.js'

// 日次実績の取り込み（#82）。PMS 連携（Phase 4、#6 / #18）ができるまでのつなぎ。
//
// PMS の出力形式ではなく、本システムの日次実績の形式（日付・販売室数・室料売上・宿泊人数）で受け取る。
// 稼働率・ADR・RevPAR はホテルの客室数から算出し、利用者に入力させない（計算の食い違いを防ぐ）。
//
// 全行を検証してから1トランザクションで upsert する。1行でも不正なら何も書き込まず、
// 行番号つきのエラーを返す（一部だけ取り込まれた状態を作らない）。

export interface DailyRowMetrics {
  occupancy: number
  adr: number | null
  revPar: number
}

/** 販売室数・室料売上・客室数から KPI を算出する（純関数） */
export function computeDailyMetrics(soldRooms: number, totalRevenue: number, totalRooms: number): DailyRowMetrics {
  return {
    occupancy: Math.round((soldRooms / totalRooms) * 1000) / 1000,
    adr: soldRooms > 0 ? Math.round(totalRevenue / soldRooms) : null,
    revPar: Math.round(totalRevenue / totalRooms),
  }
}

/**
 * スキーマでは表せない行の検証（純関数）。field は "rows.<index>.<項目>"（validate() と同じ形）
 */
export function findImportRowErrors(
  rows: ImportDailyDataInput['rows'],
  totalRooms: number
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = []
  const firstIndexByDate = new Map<string, number>()

  rows.forEach((row, index) => {
    const seen = firstIndexByDate.get(row.date)
    if (seen !== undefined) {
      errors.push({ field: `rows.${index}.date`, message: `日付 ${row.date} が ${seen + 1} 行目と重複しています` })
    } else {
      firstIndexByDate.set(row.date, index)
    }
    if (row.soldRooms > totalRooms) {
      errors.push({
        field: `rows.${index}.soldRooms`,
        message: `販売室数 ${row.soldRooms} がホテルの客室数 ${totalRooms} を超えています`,
      })
    }
    if (row.soldRooms === 0 && row.totalRevenue > 0) {
      errors.push({ field: `rows.${index}.totalRevenue`, message: '販売室数が0なのに室料売上があります' })
    }
  })
  return errors
}

export interface ImportDailyDataResult {
  dryRun: boolean
  total: number
  created: number
  updated: number
  startDate: string
  endDate: string
  tenantId: string
}

export async function importDailyDataService(input: ImportDailyDataInput): Promise<ImportDailyDataResult> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: input.hotelId, isActive: true },
    select: { id: true, tenantId: true, totalRooms: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const errors = findImportRowErrors(input.rows, hotel.totalRooms)
  if (errors.length > 0) {
    throw new BadRequestError('取り込めない行があります。1行も取り込んでいません', errors)
  }

  const dates = input.rows.map((row) => new Date(`${row.date}T00:00:00Z`))
  const sorted = input.rows.map((row) => row.date).sort()
  const existing = await prisma.dailyData.count({ where: { hotelId: hotel.id, date: { in: dates } } })

  const summary = {
    dryRun: Boolean(input.dryRun),
    total: input.rows.length,
    created: input.rows.length - existing,
    updated: existing,
    startDate: sorted[0],
    endDate: sorted[sorted.length - 1],
    tenantId: hotel.tenantId,
  }
  if (input.dryRun) return summary

  await prisma.$transaction(
    async (tx) => {
      for (const [index, row] of input.rows.entries()) {
        const values = {
          soldRooms: row.soldRooms,
          totalRevenue: row.totalRevenue,
          guests: row.guests ?? null,
          ...computeDailyMetrics(row.soldRooms, row.totalRevenue, hotel.totalRooms),
        }
        await tx.dailyData.upsert({
          where: { hotelId_date: { hotelId: hotel.id, date: dates[index] } },
          // イベント情報・メモなどの手入力項目は上書きしない
          update: values,
          create: { hotelId: hotel.id, tenantId: hotel.tenantId, date: dates[index], ...values },
        })
      }
    },
    // 1,000 行の upsert は既定の 5 秒を超えうる
    { timeout: 60_000 }
  )
  return summary
}
