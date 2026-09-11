import { Prisma } from '@prisma/client'
import type { MonthlyBudget } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { monthRange } from '../lib/date.js'
import { NotFoundError, BadRequestError, ConflictError } from '../middlewares/errorHandler.js'
import type {
  CreatePriceRankInput,
  UpdateHotelSettingsInput,
  UpsertBudgetsInput,
  CreateCompetitorInput,
  UpdateCompetitorInput,
} from '../lib/validators.js'

const MAX_PRICE_RANKS = 40 // F-SET-02

/**
 * 料金ランク一覧（F-SET-02）
 */
export async function getPriceRanksService(hotelId: string) {
  return prisma.priceRank.findMany({
    where: { hotelId, isActive: true },
    orderBy: { rank: 'asc' },
  })
}

/**
 * 料金ランク作成。
 *
 * 削除は論理削除（isActive=false）だが @@unique([hotelId, rank]) は残るため、
 * 同じランク番号で作り直すと一意制約違反（409）になっていた。
 * 非アクティブ行が残っている場合は新規作成ではなくその行を復活させる（C-5）。
 */
export async function createPriceRankService(input: CreatePriceRankInput) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const count = await prisma.priceRank.count({
    where: { hotelId: input.hotelId, isActive: true },
  })
  if (count >= MAX_PRICE_RANKS) {
    throw new BadRequestError(`料金ランクは最大${MAX_PRICE_RANKS}段階までです`)
  }

  const existing = await prisma.priceRank.findUnique({
    where: { hotelId_rank: { hotelId: input.hotelId, rank: input.rank } },
  })

  if (existing) {
    // 有効な行が既にある場合だけ重複エラー。論理削除済みなら入力値で上書きして復活させる
    if (existing.isActive) {
      throw new ConflictError(`ランク${input.rank}は既に登録されています`)
    }
    return prisma.priceRank.update({
      where: { id: existing.id },
      data: { ...input, tenantId: hotel.tenantId, isActive: true },
    })
  }

  return prisma.priceRank.create({
    data: { ...input, tenantId: hotel.tenantId },
  })
}

/**
 * 料金ランク更新
 */
export async function updatePriceRankService(
  id: string,
  hotelId: string,
  data: Partial<Omit<CreatePriceRankInput, 'hotelId' | 'rank'>>
) {
  // hotelId 条件を含めることでテナント越えの参照・更新を防ぐ
  // 監査ログの oldValue 用に更新前の行を取得しておく（S-6）
  const before = await prisma.priceRank.findFirst({ where: { id, hotelId } })
  if (!before) throw new NotFoundError('料金ランク')

  const result = await prisma.priceRank.updateMany({
    where: { id, hotelId },
    data,
  })
  if (result.count === 0) throw new NotFoundError('料金ランク')

  const after = await prisma.priceRank.findUnique({ where: { id } })
  if (!after) throw new NotFoundError('料金ランク')
  return { before, after }
}

/**
 * 料金ランク削除（論理削除）
 *
 * 監査ログに tenantId と oldValue を残すため、削除前の行を返す（S-6）。
 */
export async function deletePriceRankService(id: string, hotelId: string) {
  const before = await prisma.priceRank.findFirst({ where: { id, hotelId } })
  if (!before) throw new NotFoundError('料金ランク')

  const result = await prisma.priceRank.updateMany({
    where: { id, hotelId },
    data: { isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('料金ランク')

  return before
}

/**
 * ホテル設定更新（名称・住所・連絡先・部屋数・週末定義 — F-SET-01）
 */
export async function updateHotelSettingsService(id: string, data: UpdateHotelSettingsInput) {
  const before = await prisma.hotel.findFirst({ where: { id, isActive: true } })
  if (!before) throw new NotFoundError('ホテル')

  const after = await prisma.hotel.update({
    where: { id },
    data,
  })

  return { before, after }
}

// ======================================
// 月次予算（N-1 / F-SET-04）
// ======================================

const MONTHS_IN_YEAR = 12

/** 年間予算の1か月ぶん。行が無い月は budget=null で返す（フロントで「未登録」を区別するため） */
export interface BudgetYearMonth {
  month: number
  budget: MonthlyBudget | null
}

/**
 * 指定年の月次予算を1〜12月ぶん返す（N-1）。
 * 未登録の月も必ず要素として含め、budget を null にする。
 */
export async function getMonthlyBudgetsService(
  hotelId: string,
  year: number
): Promise<{ hotelId: string; year: number; months: BudgetYearMonth[] }> {
  const rows = await prisma.monthlyBudget.findMany({
    where: { hotelId, year },
    orderBy: { month: 'asc' },
  })
  const byMonth = new Map(rows.map((r) => [r.month, r]))

  return {
    hotelId,
    year,
    months: Array.from({ length: MONTHS_IN_YEAR }, (_, i) => ({
      month: i + 1,
      budget: byMonth.get(i + 1) ?? null,
    })),
  }
}

/**
 * 予算室数を補完する（N-1）。
 *
 * ダッシュボードの年度累計比較（dashboardService.aggregateBudgets）は budgetRooms を
 * 使って予算ADR・予算稼働率を再計算する。UI は売上・ADR・稼働率しか入力しないため、
 * 室数が未指定なら「客室数 × 予算稼働率 × 月日数」で導出しておかないと
 * 年度累計の比較対象が null になってしまう。
 */
export function deriveBudgetRooms(
  input: { budgetRooms?: number | null; budgetOccupancy?: number | null },
  totalRooms: number,
  daysInMonth: number
): number | null {
  if (input.budgetRooms != null) return input.budgetRooms
  if (input.budgetOccupancy == null) return null
  return Math.round(totalRooms * input.budgetOccupancy * daysInMonth)
}

/** 前年実績側の室数も同じ考え方で補完する */
export function deriveLastYearRooms(
  input: { lastYearRooms?: number | null; lastYearOccupancy?: number | null },
  totalRooms: number,
  daysInMonth: number
): number | null {
  if (input.lastYearRooms != null) return input.lastYearRooms
  if (input.lastYearOccupancy == null) return null
  return Math.round(totalRooms * input.lastYearOccupancy * daysInMonth)
}

/**
 * 年単位の月次予算を一括 upsert する（N-1）。
 *
 * 監査ログ用に更新前の全12か月ぶんを before として返す。
 * 送られなかった月は削除せずそのまま残す（部分更新を許す）。
 */
export async function upsertMonthlyBudgetsService(input: UpsertBudgetsInput) {
  const hotel = await prisma.hotel.findFirst({
    where: { id: input.hotelId, isActive: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const before = await getMonthlyBudgetsService(input.hotelId, input.year)

  const operations = input.months.map((m) => {
    const { daysInMonth } = monthRange(input.year, m.month)
    const values = {
      budgetRevenue: m.budgetRevenue ?? null,
      budgetAdr: m.budgetAdr ?? null,
      budgetOccupancy: m.budgetOccupancy ?? null,
      budgetGuests: m.budgetGuests ?? null,
      budgetRooms: deriveBudgetRooms(m, hotel.totalRooms, daysInMonth),
      lastYearRevenue: m.lastYearRevenue ?? null,
      lastYearAdr: m.lastYearAdr ?? null,
      lastYearOccupancy: m.lastYearOccupancy ?? null,
      lastYearGuests: m.lastYearGuests ?? null,
      lastYearRooms: deriveLastYearRooms(m, hotel.totalRooms, daysInMonth),
    }

    return prisma.monthlyBudget.upsert({
      where: {
        hotelId_year_month: { hotelId: input.hotelId, year: input.year, month: m.month },
      },
      update: values,
      create: {
        hotelId: input.hotelId,
        tenantId: hotel.tenantId,
        year: input.year,
        month: m.month,
        ...values,
      },
    })
  })

  // 12件までの upsert を1トランザクションにまとめる（部分適用を防ぐ）
  await prisma.$transaction(operations)

  const after = await getMonthlyBudgetsService(input.hotelId, input.year)
  return { tenantId: hotel.tenantId, before, after }
}

// ======================================
// 競合ホテル（N-2 / F-SET-03）
// ======================================

/** 1ホテルあたりに登録できる競合の上限（F-SET-03: 最大5社） */
export const MAX_COMPETITORS = 5

/**
 * 競合ホテル一覧（N-2）。論理削除済み（isActive=false）は返さない。
 */
export async function getCompetitorsService(hotelId: string) {
  return prisma.competitor.findMany({
    where: { hotelId, isActive: true },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * 競合ホテル作成（N-2）。
 * 有効な競合が上限（5社）に達している場合は 400 を返す。
 */
export async function createCompetitorService(input: CreateCompetitorInput) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const count = await prisma.competitor.count({
    where: { hotelId: input.hotelId, isActive: true },
  })
  if (count >= MAX_COMPETITORS) {
    throw new BadRequestError(
      `競合ホテルは最大${MAX_COMPETITORS}件までです。不要な競合を削除してから追加してください`
    )
  }

  return prisma.competitor.create({
    data: {
      hotelId: input.hotelId,
      tenantId: hotel.tenantId,
      name: input.name,
      address: input.address ?? null,
      category: input.category ?? null,
      otaUrls: input.otaUrls ?? undefined,
    },
  })
}

/**
 * 競合ホテル更新（N-2）。
 * hotelId 条件を必ず含めてテナント越えの参照・更新を防ぐ（settingsService の既存パターン）。
 */
export async function updateCompetitorService(
  id: string,
  hotelId: string,
  input: UpdateCompetitorInput
) {
  const before = await prisma.competitor.findFirst({ where: { id, hotelId, isActive: true } })
  if (!before) throw new NotFoundError('競合ホテル')

  const result = await prisma.competitor.updateMany({
    where: { id, hotelId, isActive: true },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.otaUrls !== undefined && { otaUrls: input.otaUrls ?? Prisma.DbNull }),
    },
  })
  if (result.count === 0) throw new NotFoundError('競合ホテル')

  const after = await prisma.competitor.findUnique({ where: { id } })
  if (!after) throw new NotFoundError('競合ホテル')
  return { before, after }
}

/**
 * 競合ホテル削除（N-2）。
 * 料金ランクと同じく論理削除にする（CompetitorPriceData の履歴を保持するため）。
 */
export async function deleteCompetitorService(id: string, hotelId: string) {
  const before = await prisma.competitor.findFirst({ where: { id, hotelId, isActive: true } })
  if (!before) throw new NotFoundError('競合ホテル')

  const result = await prisma.competitor.updateMany({
    where: { id, hotelId, isActive: true },
    data: { isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('競合ホテル')

  return before
}
