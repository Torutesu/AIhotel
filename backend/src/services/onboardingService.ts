import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

// オンボーディング完了状況（SAAS_ONBOARDING.md Step 5）。
// 必須5項目（§4.1）の充足をチェックし、導入担当のレビューと
// 設定画面の初期設定ウィザード（Step 4）の両方から参照する。

export interface OnboardingItem {
  key: string
  label: string
  complete: boolean
  detail: string
}

export interface HotelOnboardingStatus {
  hotelId: string
  hotelName: string
  required: OnboardingItem[]
  optional: OnboardingItem[]
  requiredCompleteCount: number
  requiredTotalCount: number
  /** 必須項目がすべて揃っているか（引き渡し可能か） */
  isComplete: boolean
}

export async function getHotelOnboardingStatusService(
  hotelId: string
): Promise<HotelOnboardingStatus> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  // 「当月・翌月」は日本市場前提のためJST基準で判定する（UTC基準だと毎月1日0〜9時JSTに前月扱いになる）
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const nowJst = new Date(Date.now() + JST_OFFSET_MS)
  const thisMonth = { year: nowJst.getUTCFullYear(), month: nowJst.getUTCMonth() + 1 }
  const next = new Date(Date.UTC(thisMonth.year, thisMonth.month, 1))
  const nextMonth = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }

  const [
    managerCount,
    operatorCount,
    roomTypeCount,
    roomCountSum,
    priceRankCount,
    strategy,
    competitorCount,
    thisMonthBudget,
    nextMonthBudget,
    dailyDataCount,
  ] = await Promise.all([
    prisma.user.count({ where: { hotelId, isActive: true, role: 'MANAGER' } }),
    prisma.user.count({ where: { hotelId, isActive: true, role: 'OPERATOR' } }),
    prisma.roomType.count({ where: { hotelId, isActive: true } }),
    prisma.roomType.aggregate({ where: { hotelId, isActive: true }, _sum: { count: true } }),
    prisma.priceRank.count({ where: { hotelId, isActive: true } }),
    prisma.pricingStrategyConfig.findUnique({ where: { hotelId } }),
    prisma.competitor.count({ where: { hotelId, isActive: true } }),
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, ...thisMonth } },
    }),
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, ...nextMonth } },
    }),
    prisma.dailyData.count({ where: { hotelId } }),
  ])

  const totalRoomTypeRooms = roomCountSum._sum.count ?? 0

  const required: OnboardingItem[] = [
    {
      key: 'hotelInfo',
      label: 'ホテル基本情報',
      complete: hotel.name.length > 0 && hotel.totalRooms > 0,
      detail: `総客室数 ${hotel.totalRooms}室`,
    },
    {
      key: 'users',
      label: '初期ユーザー（MANAGER必須）',
      complete: managerCount > 0,
      detail: `MANAGER ${managerCount}名 / OPERATOR ${operatorCount}名`,
    },
    {
      key: 'roomTypes',
      label: '客室タイプ',
      complete: roomTypeCount > 0,
      detail:
        roomTypeCount === 0
          ? '未登録'
          : `${roomTypeCount}タイプ・計${totalRoomTypeRooms}室` +
            (totalRoomTypeRooms !== hotel.totalRooms ? `（総客室数${hotel.totalRooms}室と不一致）` : ''),
    },
    {
      key: 'priceRanks',
      label: '料金ランク',
      complete: priceRankCount > 0,
      detail: priceRankCount === 0 ? '未登録' : `${priceRankCount}段階`,
    },
    {
      key: 'pricingStrategy',
      label: '価格戦略の重み',
      complete: strategy !== null,
      detail: strategy
        ? `稼働率${strategy.weightOccupancy}% / ADR${strategy.weightAdr}% / 競合${strategy.weightCompetitor}%`
        : '未設定',
    },
  ]

  const optional: OnboardingItem[] = [
    {
      key: 'competitors',
      label: '競合ホテル',
      complete: competitorCount > 0,
      detail: competitorCount === 0 ? '未登録' : `${competitorCount}社`,
    },
    {
      key: 'budgets',
      label: '月次予算（当月・翌月）',
      complete: thisMonthBudget !== null && nextMonthBudget !== null,
      detail: `当月${thisMonthBudget ? '登録済' : '未登録'} / 翌月${nextMonthBudget ? '登録済' : '未登録'}`,
    },
    {
      key: 'pastDailyData',
      label: '過去実績データ',
      complete: dailyDataCount > 0,
      detail: dailyDataCount === 0 ? '未登録' : `${dailyDataCount}日分`,
    },
  ]

  const requiredCompleteCount = required.filter((item) => item.complete).length
  return {
    hotelId: hotel.id,
    hotelName: hotel.name,
    required,
    optional,
    requiredCompleteCount,
    requiredTotalCount: required.length,
    isComplete: requiredCompleteCount === required.length,
  }
}

/**
 * テナント単位のオンボーディング状況（ADMIN・導入担当向け）
 */
export async function getTenantOnboardingStatusService(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, code: true, isActive: true, createdAt: true },
  })
  if (!tenant) throw new NotFoundError('テナント')

  const hotels = await prisma.hotel.findMany({
    where: { tenantId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  const hotelStatuses = await Promise.all(
    hotels.map((hotel) => getHotelOnboardingStatusService(hotel.id))
  )

  return {
    tenant,
    hotels: hotelStatuses,
    isComplete: hotelStatuses.length > 0 && hotelStatuses.every((h) => h.isComplete),
  }
}

/**
 * テナント一覧（ADMIN・導入担当向け）
 */
export async function listTenantsService() {
  return prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      isActive: true,
      createdAt: true,
      _count: { select: { hotels: true, users: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}
