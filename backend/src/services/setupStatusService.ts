import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import { addUtcDays, todayJst } from '../lib/date.js'

// 初期設定の進み具合（#13）。「どこまで設定すれば使い始められるか」を項目ごとに返す。
// 必須項目がすべて揃うまで、画面は予測・推奨を「初期設定が未完了のため参考値」として扱う。
// 基準（競合3社以上・過去実績1年分など）は 2026-09-23 の決定。変えるときはこの定数だけを変える。

export const SETUP_THRESHOLDS = {
  minPriceRanks: 5,
  minCompetitors: 3,
  /** 過去1年のうち、この日数以上の実績があれば「1年分ある」とみなす（抜けを許容する） */
  minActualDaysInYear: 300,
  budgetMonths: 12,
  /** 開業1年未満のホテル（Hotel.openedOn — D-13）は、開業からの日数のこの割合の実績があればよい */
  newOpeningActualRatio: 0.8,
  /** 予約の取り込みがこの日数より古ければ「止まっている」とみなす（D-13） */
  otbFreshDays: 7,
} as const

export type SetupItemKey =
  | 'basic'
  | 'roomTypes'
  | 'priceRanks'
  | 'competitors'
  | 'actuals'
  | 'users'
  | 'budget'
  | 'strategy'
  | 'saleOpen'
  | 'otb'

export interface SetupItem {
  key: SetupItemKey
  label: string
  required: boolean
  done: boolean
  /** 未完了の理由（画面にそのまま出す） */
  detail: string | null
}

export interface SetupStatus {
  hotelId: string
  /** 必須項目がすべて完了しているか */
  ready: boolean
  items: SetupItem[]
}

export async function getSetupStatusService(hotelId: string): Promise<SetupStatus> {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const today = todayJst()
  const yearAgo = addUtcDays(today, -365)
  const months = Array.from({ length: SETUP_THRESHOLDS.budgetMonths }, (_, i) => {
    const offset = today.getUTCMonth() + i
    return { year: today.getUTCFullYear() + Math.floor(offset / 12), month: (offset % 12) + 1 }
  })

  const [roomTypes, priceRankCount, competitorCount, actualDays, hotelUsers, budgets, strategy, latestOtb] = await Promise.all([
    prisma.roomType.findMany({ where: { hotelId, isActive: true }, select: { count: true } }),
    prisma.priceRank.count({ where: { hotelId, isActive: true } }),
    prisma.competitor.count({ where: { hotelId, isActive: true } }),
    prisma.dailyData.count({ where: { hotelId, date: { gte: yearAgo, lt: today }, totalRevenue: { not: null } } }),
    prisma.user.count({ where: { hotelId, isActive: true } }),
    prisma.monthlyBudget.count({
      where: { hotelId, budgetRevenue: { not: null }, OR: months.map((m) => ({ year: m.year, month: m.month })) },
    }),
    prisma.pricingStrategyConfig.findUnique({ where: { hotelId }, select: { id: true } }),
    prisma.bookingCurveData.findFirst({ where: { hotelId }, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } }),
  ])

  // 開業1年未満のホテルは、開業からの日数に合わせて必要な実績の日数を下げる（D-13）
  const daysSinceOpening = hotel.openedOn ? Math.floor((today.getTime() - hotel.openedOn.getTime()) / 86_400_000) : null
  const requiredActualDays =
    daysSinceOpening != null && daysSinceOpening < 365
      ? Math.max(0, Math.floor(daysSinceOpening * SETUP_THRESHOLDS.newOpeningActualRatio))
      : SETUP_THRESHOLDS.minActualDaysInYear
  const otbAgeDays = latestOtb ? Math.floor((Date.now() - latestOtb.capturedAt.getTime()) / 86_400_000) : null

  const missingBasic = [
    hotel.hotelType ? null : 'ホテルタイプ',
    hotel.prefectureCode ? null : '都道府県',
  ].filter((v): v is string => v !== null)
  const roomSum = roomTypes.reduce((sum, r) => sum + r.count, 0)

  const items: SetupItem[] = [
    {
      key: 'basic',
      label: 'ホテルタイプとマーケット',
      required: true,
      done: missingBasic.length === 0,
      detail: missingBasic.length === 0 ? null : `${missingBasic.join('・')}が未設定です`,
    },
    {
      key: 'roomTypes',
      label: '部屋タイプ',
      required: true,
      done: roomTypes.length > 0 && roomSum === hotel.totalRooms,
      detail:
        roomTypes.length === 0
          ? '部屋タイプが登録されていません'
          : roomSum !== hotel.totalRooms
            ? `部屋タイプの室数の合計 ${roomSum} が総客室数 ${hotel.totalRooms} と一致しません`
            : null,
    },
    {
      key: 'priceRanks',
      label: '料金ランク',
      required: true,
      done: priceRankCount >= SETUP_THRESHOLDS.minPriceRanks,
      detail:
        priceRankCount >= SETUP_THRESHOLDS.minPriceRanks
          ? null
          : `料金ランクが ${priceRankCount} 段階です（${SETUP_THRESHOLDS.minPriceRanks} 段階以上必要）`,
    },
    {
      key: 'competitors',
      label: '競合ホテル',
      required: true,
      done: competitorCount >= SETUP_THRESHOLDS.minCompetitors,
      detail:
        competitorCount >= SETUP_THRESHOLDS.minCompetitors
          ? null
          : `競合が ${competitorCount} 社です（${SETUP_THRESHOLDS.minCompetitors} 社以上必要）`,
    },
    {
      key: 'actuals',
      label: requiredActualDays < SETUP_THRESHOLDS.minActualDaysInYear ? '過去実績（開業から）' : '過去実績（直近1年）',
      required: true,
      done: actualDays >= requiredActualDays,
      detail:
        actualDays >= requiredActualDays
          ? null
          : requiredActualDays < SETUP_THRESHOLDS.minActualDaysInYear
            ? `開業から ${daysSinceOpening} 日のうち、実績が ${actualDays} 日分です（${requiredActualDays} 日分以上必要）`
            : `直近1年の実績が ${actualDays} 日分です（${SETUP_THRESHOLDS.minActualDaysInYear} 日分以上必要）`,
    },
    {
      key: 'users',
      label: 'ホテルの利用者',
      required: true,
      done: hotelUsers > 0,
      detail: hotelUsers > 0 ? null : 'このホテルに所属する利用者がいません',
    },
    {
      key: 'budget',
      label: '月次予算（今月から12か月）',
      required: false,
      done: budgets >= SETUP_THRESHOLDS.budgetMonths,
      detail:
        budgets >= SETUP_THRESHOLDS.budgetMonths
          ? null
          : `予算が登録されている月は ${budgets} か月です（予算比の表示に使います）`,
    },
    {
      key: 'strategy',
      label: '価格戦略（重み・ランクの幅）',
      required: false,
      done: strategy != null,
      detail: strategy ? null : '価格戦略が未保存です（稼働率だけで推奨ランクを決めます）',
    },
    {
      key: 'saleOpen',
      label: '販売開始（宿泊日の何日前から）',
      required: false,
      done: hotel.saleOpenDaysBefore != null,
      detail: hotel.saleOpenDaysBefore != null ? null : '販売開始が未設定です（販売開始チェックの対象月に使います）',
    },
    {
      key: 'otb',
      label: '予約（OTB）の取り込み',
      required: false,
      done: otbAgeDays != null && otbAgeDays <= SETUP_THRESHOLDS.otbFreshDays,
      detail:
        otbAgeDays == null
          ? '予約の取り込みがまだありません（予約の入り方・似た日の予測に使います）'
          : otbAgeDays > SETUP_THRESHOLDS.otbFreshDays
            ? `予約の取り込みが ${otbAgeDays} 日前で止まっています`
            : null,
    },
  ]

  return { hotelId, ready: items.every((i) => !i.required || i.done), items }
}
