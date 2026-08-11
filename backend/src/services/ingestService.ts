import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type {
  IngestNightsInput,
  IngestReservationRow,
  IngestReservationsInput,
  IngestInventoryInput,
} from '../lib/validators.js'

// ======================================
// PMS取込サービス（Phase 4A — F-OH-01/02, F-INV-01, F-ING-01）
// 仕様書Ⅲ章: 取込は「当日から180日分の予約情報＋前日1日分の実績」。
// クローラ側はデータを保持しないため、同一対象（日付/断面）の再送は全量置換で冪等にする。
// ======================================

const DAY_MS = 24 * 60 * 60 * 1000

/** 日付をUTC日単位に正規化する（@db.Date カラムへの格納用） */
export function toUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function dateKey(d: Date): string {
  return toUtcDate(d).toISOString().slice(0, 10)
}

export interface StayNight {
  stayDate: Date
  rooms: number
  guests: number | null
  roomRevenue: number | null
  roomTypeCode: string
  marketCode: string | null
}

/**
 * 予約1件を1泊単位に展開する（機能リスト: 計上日が無いPMSはシステム内で1泊単位のデータを生成）。
 * 室料は泊数で均等按分する（PMS側に泊別内訳が無いため）。
 */
export function expandStayNights(row: IngestReservationRow): StayNight[] {
  const checkIn = toUtcDate(row.checkIn)
  const checkOut = toUtcDate(row.checkOut)
  const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS))
  const revenuePerNight = row.roomRevenue != null ? row.roomRevenue / nights : null

  const result: StayNight[] = []
  for (let i = 0; i < nights; i++) {
    result.push({
      stayDate: new Date(checkIn.getTime() + i * DAY_MS),
      rooms: row.rooms,
      guests: row.guests ?? null,
      roomRevenue: revenuePerNight,
      roomTypeCode: row.roomTypeCode,
      marketCode: row.marketCode ?? null,
    })
  }
  return result
}

export interface OnHandAggregate {
  stayDate: Date
  rooms: number
  revenue: number
  guests: number
  byRoomType: Record<string, { rooms: number; revenue: number }>
  byMarket: Record<string, { rooms: number; revenue: number }>
}

/**
 * オンハンド予約明細から宿泊日別の積上を集計する（キャンセル済みは除外）。
 * OnHandSnapshot（F-OH-02）の元データ。
 */
export function aggregateOnHand(rows: IngestReservationRow[]): OnHandAggregate[] {
  const map = new Map<string, OnHandAggregate>()

  for (const row of rows) {
    if (row.cancelledAt != null) continue
    for (const night of expandStayNights(row)) {
      const key = dateKey(night.stayDate)
      let agg = map.get(key)
      if (!agg) {
        agg = {
          stayDate: night.stayDate,
          rooms: 0,
          revenue: 0,
          guests: 0,
          byRoomType: {},
          byMarket: {},
        }
        map.set(key, agg)
      }
      agg.rooms += night.rooms
      agg.revenue += night.roomRevenue ?? 0
      agg.guests += night.guests ?? 0

      const rt = (agg.byRoomType[night.roomTypeCode] ??= { rooms: 0, revenue: 0 })
      rt.rooms += night.rooms
      rt.revenue += night.roomRevenue ?? 0

      const mk = night.marketCode ?? 'UNKNOWN'
      const ms = (agg.byMarket[mk] ??= { rooms: 0, revenue: 0 })
      ms.rooms += night.rooms
      ms.revenue += night.roomRevenue ?? 0
    }
  }

  return [...map.values()].sort((a, b) => a.stayDate.getTime() - b.stayDate.getTime())
}

async function resolveHotel(hotelId: string) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')
  return hotel
}

interface IngestLogParams {
  tenantId: string
  hotelId: string
  source: string
  startedAt: Date
  targetDate?: Date
  rowCount?: number
  columns?: string[]
  createdByUserId?: string
  provenance?: IngestProvenance
}

/**
 * データの出所。自動取得（コネクタ）経由のときに埋まる。
 * checksum は同一ファイルの二重取込を避けるための鍵として取込ログに残す。
 */
export interface IngestProvenance {
  origin?: string
  checksum?: string
}

async function writeIngestLog(
  params: IngestLogParams,
  status: 'SUCCESS' | 'FAILED',
  error?: string
): Promise<void> {
  // 取込ログは本体処理の成否に関わらず必ず残す（仕様書Ⅲ章3.5）。ログ失敗で取込を失敗させない
  try {
    await prisma.ingestLog.create({
      data: {
        tenantId: params.tenantId,
        hotelId: params.hotelId,
        source: params.source,
        status,
        startedAt: params.startedAt,
        finishedAt: new Date(),
        targetDate: params.targetDate ?? null,
        rowCount: params.rowCount ?? null,
        columns: params.columns ?? undefined,
        error: error ?? null,
        createdByUserId: params.createdByUserId ?? null,
        origin: params.provenance?.origin ?? null,
        checksum: params.provenance?.checksum ?? null,
      },
    })
  } catch {
    // ロガー経由のエラー出力は errorHandler に任せ、ここでは握りつぶす
  }
}

// 一括取込は実データで数万行になる（実測: 1ヶ月分の実績で約24,000行）。
// Prismaの対話トランザクションは既定5秒で切れるため、明示的に延長する。
// あわせて createMany をチャンク分割し、1文あたりのプレースホルダ数がPostgreSQLの
// 上限（65535）を超えないようにする。
const BULK_TX_OPTIONS = { maxWait: 15_000, timeout: 180_000 } as const
const CREATE_MANY_CHUNK = 2_000

/** createMany をチャンクに分けて実行する（大量行対策） */
async function createManyChunked<T>(
  rows: T[],
  create: (chunk: T[]) => Promise<unknown>
): Promise<void> {
  for (let i = 0; i < rows.length; i += CREATE_MANY_CHUNK) {
    await create(rows.slice(i, i + CREATE_MANY_CHUNK))
  }
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>()
  for (const row of rows.slice(0, 100)) {
    for (const [k, v] of Object.entries(row)) {
      if (v !== undefined) keys.add(k)
    }
  }
  return [...keys].sort()
}

/**
 * 宿泊実績1泊明細の取込（前日実績・過去データ移行 — F-OH-01）。
 * rows に含まれる計上日（stayDate）単位で全量置換し、再送に対して冪等とする。
 */
export async function ingestNightsService(
  input: IngestNightsInput,
  userId?: string,
  provenance?: IngestProvenance
) {
  const hotel = await resolveHotel(input.hotelId)
  const startedAt = new Date()
  const targetDates = [...new Set(input.rows.map((r) => dateKey(r.stayDate)))].map(
    (k) => new Date(`${k}T00:00:00.000Z`)
  )
  const logBase: IngestLogParams = {
    tenantId: hotel.tenantId,
    hotelId: hotel.id,
    source: 'pms-nights',
    startedAt,
    rowCount: input.rows.length,
    columns: collectColumns(input.rows),
    provenance,
    createdByUserId: userId,
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.reservationNight.deleteMany({
        where: { hotelId: hotel.id, stayDate: { in: targetDates } },
      })
      await createManyChunked(input.rows, (chunk) =>
        tx.reservationNight.createMany({
        data: chunk.map((r) => ({
          tenantId: hotel.tenantId,
          hotelId: hotel.id,
          stayDate: toUtcDate(r.stayDate),
          roomTypeCode: r.roomTypeCode,
          rateTypeCode: r.rateTypeCode ?? null,
          packageCode: r.packageCode ?? null,
          rooms: r.rooms,
          guests: r.guests ?? null,
          guestsDetail: (r.guestsDetail as Prisma.InputJsonValue | undefined) ?? undefined,
          roomRevenue: r.roomRevenue ?? null,
          serviceFee: r.serviceFee ?? null,
          agentCode: r.agentCode ?? null,
          regionCode: r.regionCode ?? null,
          marketCode: r.marketCode ?? null,
          individualGroupType: r.individualGroupType ?? null,
          buildingCode: r.buildingCode ?? null,
          blockCode: r.blockCode ?? null,
          checkIn: r.checkIn ? toUtcDate(r.checkIn) : null,
          checkOut: r.checkOut ? toUtcDate(r.checkOut) : null,
          isDayUse: r.isDayUse ?? false,
          compHuType: r.compHuType ?? null,
        })),
        })
      )
    }, BULK_TX_OPTIONS)
    await writeIngestLog(logBase, 'SUCCESS')
    return { inserted: input.rows.length, replacedDates: targetDates.length }
  } catch (error) {
    await writeIngestLog(logBase, 'FAILED', error instanceof Error ? error.message : String(error))
    throw error
  }
}

/**
 * オンハンド予約明細の取込（180日分の断面 — F-OH-01/02）。
 * capturedDate 単位で全量置換し、OnHandSnapshot（宿泊日別積上）を同時に再計算する。
 */
export async function ingestReservationsService(
  input: IngestReservationsInput,
  userId?: string,
  provenance?: IngestProvenance
) {
  const hotel = await resolveHotel(input.hotelId)
  const startedAt = new Date()
  const capturedDate = toUtcDate(input.capturedDate)
  const logBase: IngestLogParams = {
    tenantId: hotel.tenantId,
    hotelId: hotel.id,
    source: 'pms-reservations',
    startedAt,
    targetDate: capturedDate,
    rowCount: input.rows.length,
    columns: collectColumns(input.rows),
    provenance,
    createdByUserId: userId,
  }

  try {
    const aggregates = aggregateOnHand(input.rows)
    await prisma.$transaction(async (tx) => {
      await tx.reservation.deleteMany({ where: { hotelId: hotel.id, capturedDate } })
      await createManyChunked(input.rows, (chunk) =>
        tx.reservation.createMany({
        data: chunk.map((r) => ({
          tenantId: hotel.tenantId,
          hotelId: hotel.id,
          capturedDate,
          bookedAt: r.bookedAt ?? null,
          cancelledAt: r.cancelledAt ?? null,
          checkIn: toUtcDate(r.checkIn),
          checkOut: toUtcDate(r.checkOut),
          roomTypeCode: r.roomTypeCode,
          rateTypeCode: r.rateTypeCode ?? null,
          packageCode: r.packageCode ?? null,
          rooms: r.rooms,
          guests: r.guests ?? null,
          roomRevenue: r.roomRevenue ?? null,
          serviceFee: r.serviceFee ?? null,
          agentCode: r.agentCode ?? null,
          regionCode: r.regionCode ?? null,
          marketCode: r.marketCode ?? null,
          isGroup: r.isGroup ?? false,
        })),
        })
      )
      await tx.onHandSnapshot.deleteMany({ where: { hotelId: hotel.id, capturedDate } })
      await createManyChunked(aggregates, (chunk) =>
        tx.onHandSnapshot.createMany({
        data: chunk.map((a) => ({
          tenantId: hotel.tenantId,
          hotelId: hotel.id,
          stayDate: a.stayDate,
          capturedDate,
          rooms: a.rooms,
          revenue: a.revenue,
          guests: a.guests,
          segments: {
            byRoomType: a.byRoomType,
            byMarket: a.byMarket,
          } as Prisma.InputJsonValue,
        })),
        })
      )
    }, BULK_TX_OPTIONS)
    await writeIngestLog(logBase, 'SUCCESS')
    return {
      inserted: input.rows.length,
      snapshotDates: aggregates.length,
      capturedDate,
    }
  } catch (error) {
    await writeIngestLog(logBase, 'FAILED', error instanceof Error ? error.message : String(error))
    throw error
  }
}

/**
 * 残室スナップショットの取込（日別×タイプ別 — F-INV-01）。capturedDate 単位で全量置換。
 */
export async function ingestInventoryService(
  input: IngestInventoryInput,
  userId?: string,
  provenance?: IngestProvenance
) {
  const hotel = await resolveHotel(input.hotelId)
  const startedAt = new Date()
  const capturedDate = toUtcDate(input.capturedDate)
  const logBase: IngestLogParams = {
    tenantId: hotel.tenantId,
    hotelId: hotel.id,
    source: 'pms-inventory',
    startedAt,
    targetDate: capturedDate,
    rowCount: input.rows.length,
    columns: collectColumns(input.rows),
    provenance,
    createdByUserId: userId,
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.roomInventorySnapshot.deleteMany({ where: { hotelId: hotel.id, capturedDate } })
      await createManyChunked(input.rows, (chunk) =>
        tx.roomInventorySnapshot.createMany({
        data: chunk.map((r) => ({
          tenantId: hotel.tenantId,
          hotelId: hotel.id,
          roomTypeCode: r.roomTypeCode,
          stayDate: toUtcDate(r.stayDate),
          capturedDate,
          remainingRooms: r.remainingRooms,
          totalRooms: r.totalRooms ?? null,
        })),
        })
      )
    }, BULK_TX_OPTIONS)
    await writeIngestLog(logBase, 'SUCCESS')
    return { inserted: input.rows.length, capturedDate }
  } catch (error) {
    await writeIngestLog(logBase, 'FAILED', error instanceof Error ? error.message : String(error))
    throw error
  }
}

/**
 * 取込ログ一覧（仕様書Ⅲ章3.5: オペレーター・サポートがいつでも状態確認できること）
 */
export async function getIngestLogsService(hotelId: string, limit: number) {
  return prisma.ingestLog.findMany({
    where: { hotelId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
