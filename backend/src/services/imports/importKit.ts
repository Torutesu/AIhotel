import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../../middlewares/errorHandler.js'

// 取り込みの共通部品（D-13）。CSV・シートの取り込み（日次実績・OTB・過去の予約積上・競合価格・イベント・新規ホテル）は
// どれも同じ流れなので、その流れをここにまとめる:
//   1. 有効なホテルを読む（無ければ 404）
//   2. 行を検証する。エラーの field は validate() と同じ "rows.<行の添字>.<項目>"。重複は「n 行目と重複」
//   3. エラーが1件でもあれば何も書かずに 400（一部だけ取り込まれた状態を作らない）
//   4. 既存の件数から作成・上書きの件数と期間をまとめる。dryRun ならここで返す
//   5. 1トランザクションで書く（数千行の upsert は既定の5秒を超えるので IMPORT_TX_TIMEOUT_MS）
// 新しい取り込みを足すときはこの部品で書く（取り込み経路ごとに少しずつ違う実装を増やさない）。

export const IMPORT_TX_TIMEOUT_MS = 60_000
export const NOTHING_IMPORTED = '取り込めない行があります。1行も取り込んでいません'

export interface ImportHotel {
  id: string
  tenantId: string
  totalRooms: number
}

export async function loadImportHotel(hotelId: string): Promise<ImportHotel> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { id: true, tenantId: true, totalRooms: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')
  return hotel
}

export interface RowError {
  field: string
  message: string
}

/** 行のエラーを集める。重複の検出も持つ */
export class RowErrors {
  readonly list: RowError[] = []
  private readonly seen = new Map<string, Map<string, number>>()

  add(index: number, field: string, message: string): void {
    this.list.push({ field: `rows.${index}.${field}`, message })
  }

  /** 同じキー（group ごと）が前の行にあればエラーにする。label は「日付 2026-12-01」のような表示 */
  duplicate(index: number, field: string, key: string, label: string, group = field): void {
    const map = this.seen.get(group) ?? new Map<string, number>()
    this.seen.set(group, map)
    const first = map.get(key)
    if (first !== undefined) this.add(index, field, `${label} が ${first + 1} 行目と重複しています`)
    else map.set(key, index)
  }

  /** エラーがあれば何も書かずに 400 */
  throwIfAny(): void {
    rejectRows(this.list)
  }
}

/** 純関数の検証が返したエラーがあれば、何も書かずに 400 */
export function rejectRows(errors: RowError[]): void {
  if (errors.length > 0) throw new BadRequestError(NOTHING_IMPORTED, errors)
}

export interface ImportSummary {
  dryRun: boolean
  total: number
  created: number
  updated: number
  startDate: string
  endDate: string
  tenantId: string
}

/** 件数と期間をまとめ、dryRun でなければ1トランザクションで書く */
export async function commitImport<E extends object>(params: {
  hotel: ImportHotel
  dryRun?: boolean
  /** 期間に使う日付（YYYY-MM-DD） */
  dates: string[]
  existing: number
  extra?: E
  write: (tx: Prisma.TransactionClient) => Promise<void>
}): Promise<ImportSummary & E> {
  const sorted = [...params.dates].sort()
  const summary = {
    dryRun: Boolean(params.dryRun),
    ...(params.extra ?? ({} as E)),
    total: params.dates.length,
    created: params.dates.length - params.existing,
    updated: params.existing,
    startDate: sorted[0],
    endDate: sorted[sorted.length - 1],
    tenantId: params.hotel.tenantId,
  }
  if (!params.dryRun) await prisma.$transaction(params.write, { timeout: IMPORT_TX_TIMEOUT_MS })
  return summary
}

/** "YYYY-MM-DD" を UTC 0時の Date に */
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
