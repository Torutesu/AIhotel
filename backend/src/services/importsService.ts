import { prisma } from '../lib/prisma.js'
import { commitImport, loadImportHotel, rejectRows, RowErrors, toDate, type ImportSummary, type RowError } from './imports/importKit.js'
import type { ImportDailyDataInput } from '../lib/validators.js'

// 日次実績の取り込み（#82）。PMS 連携（Phase 4、#6 / #18）ができるまでのつなぎ。
//
// PMS の出力形式ではなく、本システムの日次実績の形式（日付・販売室数・室料売上・宿泊人数）で受け取る。
// 稼働率・ADR・RevPAR はホテルの客室数から算出し、利用者に入力させない（計算の食い違いを防ぐ）。
//
// 全行を検証してから1トランザクションで upsert する。1行でも不正なら何も書き込まず、
// 行番号つきのエラーを返す（一部だけ取り込まれた状態を作らない — 流れは imports/importKit.ts の共通部品）。

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
export function findImportRowErrors(rows: ImportDailyDataInput['rows'], totalRooms: number): RowError[] {
  const errors = new RowErrors()
  rows.forEach((row, index) => {
    errors.duplicate(index, 'date', row.date, `日付 ${row.date}`)
    if (row.soldRooms > totalRooms) {
      errors.add(index, 'soldRooms', `販売室数 ${row.soldRooms} がホテルの客室数 ${totalRooms} を超えています`)
    }
    if (row.soldRooms === 0 && row.totalRevenue > 0) errors.add(index, 'totalRevenue', '販売室数が0なのに室料売上があります')
  })
  return errors.list
}

export type ImportDailyDataResult = ImportSummary

export async function importDailyDataService(input: ImportDailyDataInput): Promise<ImportDailyDataResult> {
  const hotel = await loadImportHotel(input.hotelId)
  rejectRows(findImportRowErrors(input.rows, hotel.totalRooms))

  const dates = input.rows.map((row) => toDate(row.date))
  return commitImport({
    hotel,
    dryRun: input.dryRun,
    dates: input.rows.map((row) => row.date),
    existing: await prisma.dailyData.count({ where: { hotelId: hotel.id, date: { in: dates } } }),
    write: async (tx) => {
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
  })
}
