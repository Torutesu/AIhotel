// 予約明細の取込（Phase 4 の前段 / 現地テスト検証用）。
//
// 変換は lib/reservationImport.ts の純粋関数で行い、このファイルは永続化だけを担う。
// すべて upsert（DailyData=hotelId+date、OtaChannelData=hotelId+date+channel、
// BookingCurveData=hotelId+stayDate+daysBefore、DailyRoomData=dailyDataId+roomTypeId）なので
// 同じCSVを何度取り込んでも行は増えない（冪等）。

import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { logger } from '../utils/logger.js'
import { addUtcDays, todayJst } from '../lib/date.js'
import { decodeCsv, parseCsv, toRecords } from '../lib/csv.js'
import { evaluateImportFreshness, type ImportFreshnessStatus } from '../lib/importHealth.js'
import {
  aggregateByChannel,
  aggregateByRoomType,
  aggregateDaily,
  normalizeReservations,
  parseCalendarDate,
  reconstructBookingCurve,
  reservationMappingSchema,
  type ReservationRecord,
} from '../lib/reservationImport.js'
import type {
  ImportReservationsQueryInput,
  UpsertImportMappingInput,
} from '../lib/validators.js'

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

// ======================================
// 列マッピング（無人運用では端末はファイルを送るだけにし、列の対応はサーバに置く）
// ======================================

/** 取込に使う列マッピング（保存形式） */
export interface StoredImportMapping {
  hotelId: string
  source: string
  encoding: string
  delimiter: string
  mapping: unknown
  updatedAt: Date
}

/** ホテル（＋取得元）の列マッピングを保存する。同じ組み合わせは上書きする */
export async function upsertImportMappingService(
  input: UpsertImportMappingInput,
  userId: string
): Promise<StoredImportMapping> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: input.hotelId, isActive: true },
    select: { id: true, tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const saved = await prisma.importMapping.upsert({
    where: { hotelId_source: { hotelId: input.hotelId, source: input.source } },
    update: {
      encoding: input.encoding,
      delimiter: input.delimiter,
      mapping: input.mapping as Prisma.InputJsonValue,
      updatedByUserId: userId,
    },
    create: {
      tenantId: hotel.tenantId,
      hotelId: input.hotelId,
      source: input.source,
      encoding: input.encoding,
      delimiter: input.delimiter,
      mapping: input.mapping as Prisma.InputJsonValue,
      updatedByUserId: userId,
    },
    select: { hotelId: true, source: true, encoding: true, delimiter: true, mapping: true, updatedAt: true },
  })

  return saved
}

/** 保存済みの列マッピングを返す（source 未指定なら全件） */
export async function listImportMappingsService(
  hotelId: string,
  source?: string
): Promise<StoredImportMapping[]> {
  return prisma.importMapping.findMany({
    where: { hotelId, ...(source ? { source } : {}) },
    orderBy: { source: 'asc' },
    select: { hotelId: true, source: true, encoding: true, delimiter: true, mapping: true, updatedAt: true },
  })
}

// ======================================
// CSV取込（POST /import/reservations の実体）
// ======================================

export interface CsvImportResult {
  runId: string
  status: 'success' | 'failed'
  dryRun: boolean
  fileName: string | null
  fileBytes: number
  /** 同じ内容のファイルを以前に取り込んでいれば、その実行ID（再送の気づきに使う） */
  duplicateOfRunId: string | null
  rowCount: number
  skippedRows: number
  cancelledRows: number
  summary: ImportSummary
  /** 取り込めたが注意が必要な点（受付日の列が無い等） */
  warnings: string[]
}

/**
 * CSV本体を受け取って取り込む。保存済みの列マッピングを使うため、
 * 端末側はファイルとホテルIDだけを送れば済む（無人運用の前提）。
 *
 * 実行は必ず ImportRun に記録する。成功も失敗も残すことで、
 * 「いつから取り込めていないか」を後から追える（欠損検知の材料）。
 */
export async function importReservationCsvService(params: {
  query: ImportReservationsQueryInput
  csv: Buffer
  userId: string
}): Promise<CsvImportResult> {
  const { query, csv, userId } = params

  if (csv.length === 0) throw new BadRequestError('CSVが空です')

  const hotel = await prisma.hotel.findFirst({
    where: { id: query.hotelId, isActive: true },
    select: { id: true, tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const stored = await prisma.importMapping.findUnique({
    where: { hotelId_source: { hotelId: query.hotelId, source: query.source } },
  })
  if (!stored) {
    throw new NotFoundError(`列マッピング（${query.source}）`)
  }

  const fileHash = createHash('sha256').update(csv).digest('hex')
  // dry-run は「取り込んだ」ことにならないので重複判定から除く
  const duplicate = await prisma.importRun.findFirst({
    where: { hotelId: query.hotelId, source: query.source, fileHash, status: 'success', dryRun: false },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  })

  const run = await prisma.importRun.create({
    data: {
      tenantId: hotel.tenantId,
      hotelId: query.hotelId,
      source: query.source,
      fileName: query.fileName ?? null,
      fileHash,
      fileBytes: csv.length,
      status: 'running',
      dryRun: query.dryRun,
      userId,
    },
    select: { id: true },
  })

  try {
    const mapping = reservationMappingSchema.parse(stored.mapping)
    const text = decodeCsv(csv, stored.encoding)
    const { headers, records } = toRecords(parseCsv(text, stored.delimiter === 'tab' ? '\t' : stored.delimiter))

    if (headers.length <= 1) {
      throw new BadRequestError(
        'CSVの列を1つしか認識できませんでした。保存済みマッピングの文字コード・区切り文字を確認してください'
      )
    }

    const normalized = normalizeReservations(records, mapping)
    const asOf = query.asOf ? parseCalendarDate(query.asOf) : todayJst()
    if (!asOf) throw new BadRequestError('asOf の形式が不正です')

    const summary = await importReservationDataService({
      hotelId: query.hotelId,
      records: normalized.records,
      asOf,
      maxDaysBefore: query.maxDaysBefore,
      dryRun: query.dryRun,
    })

    const warnings: string[] = []
    if (!mapping.bookedAt) {
      warnings.push('予約受付日の列が未設定のため、ブッキングカーブは作成されません（A2）')
    }
    if (!mapping.cancelledAt && mapping.cancelStatusValues.length === 0) {
      warnings.push('取消日・キャンセルステータスの設定が無いため、キャンセルを除外できません（A3）')
    }
    if (summary.unknownRoomTypeCodes.length > 0) {
      warnings.push(
        `客室タイプマスタに無いコードを取り込みませんでした: ${summary.unknownRoomTypeCodes.join(', ')}`
      )
    }
    if (normalized.skipped.length > 0) {
      warnings.push(`${normalized.skipped.length}行を取り込めませんでした（先頭: ${normalized.skipped[0].reason}）`)
    }
    if (duplicate) {
      warnings.push('同じ内容のファイルを以前に取り込んでいます（内容は同じなので結果は変わりません）')
    }

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: 'success',
        rowCount: records.length,
        dailyRows: summary.dailyRows,
        roomTypeRows: summary.roomTypeRows,
        channelRows: summary.channelRows,
        curveRows: summary.curveRows,
        skippedRows: normalized.skipped.length,
        cancelledRows: normalized.cancelledRows,
        stayDateFrom: summary.stayDateFrom ? new Date(`${summary.stayDateFrom}T00:00:00.000Z`) : null,
        stayDateTo: summary.stayDateTo ? new Date(`${summary.stayDateTo}T00:00:00.000Z`) : null,
        finishedAt: new Date(),
      },
    })

    return {
      runId: run.id,
      status: 'success',
      dryRun: query.dryRun,
      fileName: query.fileName ?? null,
      fileBytes: csv.length,
      duplicateOfRunId: duplicate?.id ?? null,
      rowCount: records.length,
      skippedRows: normalized.skipped.length,
      cancelledRows: normalized.cancelledRows,
      summary,
      warnings,
    }
  } catch (error) {
    // 失敗も履歴に残す（無人運用では「失敗したこと」が最も重要な情報になる）
    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        finishedAt: new Date(),
      },
    })
    throw error
  }
}

// ======================================
// 取込履歴と鮮度
// ======================================

export async function listImportRunsService(hotelId: string, source: string | undefined, limit: number) {
  return prisma.importRun.findMany({
    where: { hotelId, ...(source ? { source } : {}) },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      source: true,
      fileName: true,
      fileBytes: true,
      status: true,
      dryRun: true,
      rowCount: true,
      dailyRows: true,
      channelRows: true,
      curveRows: true,
      skippedRows: true,
      cancelledRows: true,
      stayDateFrom: true,
      stayDateTo: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
    },
  })
}

export interface ImportFreshnessReport {
  hotelId: string
  status: ImportFreshnessStatus
  message: string
  lastSuccessAt: Date | null
  alertCreated: boolean
}

/**
 * 取込が止まっていないかを判定し、必要ならアラートを立てる（日次バッチから呼ぶ）。
 *
 * 同じホテル・同じ対象日で OPEN のアラートがあれば作り直さない（毎日同じ行が増えない）。
 * 一度も取り込んでいないホテル（seed運用中）はアラートを出さない。
 */
export async function checkImportFreshnessService(
  hotelId: string,
  now: Date = new Date()
): Promise<ImportFreshnessReport> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { id: true, tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const yesterday = addUtcDays(todayJst(now), -1)

  const [lastSuccess, previousDay] = await Promise.all([
    prisma.importRun.findFirst({
      where: { hotelId, status: 'success', dryRun: false },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    }),
    prisma.dailyData.findFirst({
      where: { hotelId, date: yesterday, soldRooms: { not: null } },
      select: { id: true },
    }),
  ])

  const freshness = evaluateImportFreshness({
    hasPreviousDayData: previousDay != null,
    lastSuccessAt: lastSuccess?.startedAt ?? null,
    now,
  })

  const needsAlert = freshness.status === 'stale' || freshness.status === 'missing-previous-day'
  if (!needsAlert) {
    return {
      hotelId,
      status: freshness.status,
      message: freshness.message,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      alertCreated: false,
    }
  }

  const title = 'データ取込が停止しています'
  const existing = await prisma.alert.findFirst({
    where: { hotelId, title, status: 'OPEN', targetDate: yesterday },
    select: { id: true },
  })

  if (!existing) {
    await prisma.alert.create({
      data: {
        tenantId: hotel.tenantId,
        hotelId,
        severity: 'RED',
        level: 5,
        title,
        message: `${freshness.message}。取込端末・スケジューラと、サイトコントローラー側の出力を確認してください。`,
        linkTab: 'settings',
        targetDate: yesterday,
      },
    })
    logger.warn({ hotelId, status: freshness.status }, '取込の欠損を検知してアラートを作成した')
  }

  return {
    hotelId,
    status: freshness.status,
    message: freshness.message,
    lastSuccessAt: lastSuccess?.startedAt ?? null,
    alertCreated: !existing,
  }
}

