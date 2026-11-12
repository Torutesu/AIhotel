// 日別価格カレンダーのタイプ別の数値（2026-10-24 の画面修正: 現在・推奨料金ランクの上のタイプ切り替え）。
// backend の pricingService（GET /pricing/calendar?roomTypeId=）と frontend のデモ（mockPricingCalendarForRoomType）で
// 同じ式を使うため shared に置く。backend は dist（shared の build）を実行時に読み込む。

/** タイプ別に見るときの配分の比（backend の ROOM_TYPE_MIX_DAYS 日のタイプ別の販売構成・単価） */
export interface RoomTypeMix {
  /** 全タイプの販売室数に占めるこのタイプの割合 */
  roomShare: number
  /** このタイプの ADR ÷ 全タイプの ADR */
  adrRatio: number
}

/**
 * タイプ別の販売実績の合計から配分の比を出す（純関数）。
 * 実績が無いホテル（取り込み前など）は客室数の比・単価は同じとみなす（fallbackShare）
 */
export function roomTypeMixFrom(
  totals: Array<{ roomTypeId: string; soldRooms: number; revenue: number }>,
  roomTypeId: string,
  fallbackShare: number
): RoomTypeMix {
  const allSold = totals.reduce((a, t) => a + t.soldRooms, 0)
  const allRevenue = totals.reduce((a, t) => a + t.revenue, 0)
  if (allSold <= 0) return { roomShare: fallbackShare, adrRatio: 1 }
  const type = totals.find((t) => t.roomTypeId === roomTypeId)
  const typeSold = type?.soldRooms ?? 0
  const typeRevenue = type?.revenue ?? 0
  const allAdr = allRevenue / allSold
  return {
    roomShare: typeSold / allSold,
    adrRatio: typeSold > 0 && allAdr > 0 ? typeRevenue / typeSold / allAdr : 1,
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** タイプ別に置き換える値（予算は持たないので null） */
export interface RoomTypeDayValues {
  budgetRooms: null
  budgetOccupancy: null
  budgetAdr: null
  budgetRevenue: null
  actualOccupancy: number | null
  actualAdr: number | null
  onHandRooms: number | null
  currentOccupancy: number | null
  onHandAdr: number | null
  currentRevenue: number | null
  predictedOccupancy: number | null
  predictedAdr: number | null
  expectedRevenue: number | null
}

/**
 * ALL（全タイプの合計）の1日を、1つの部屋タイプの数値に直す（純関数 — 2026-10-24 の画面修正）。
 * - 予算: タイプ別には持たない（導入時のヒアリングによる）ので null（画面は「-」）
 * - 現在（結果・予約）: 結果の出た日はタイプ別の実績（DailyRoomData）。先の日のタイプ別の予約室数は
 *   PMS／サイトコントローラー連携まで無いので null
 * - AI の想定値: ホテル全体の予測を、過去のタイプ別の販売構成（室数の比）と単価の比で配る。
 *   部屋売り（人数で価格が変わらない）を前提にした配り方。人数売りの施設は DOR と客単価で出す（導入時に対応）
 * - 料金ランク・需要のアラート・日のタイプ・競合はタイプ共通（日の性質・全タイプ共通のランクの段階）
 */
export function toRoomTypeDay<
  T extends {
    predictedOccupancy: number | null
    predictedAdr: number | null
    recommendedPrice: number | null
  },
>(
  day: T,
  ctx: {
    /** このタイプの室数 */
    count: number
    /** ホテルの客室数（AI の予測稼働率から室数を出す） */
    hotelRooms: number
    mix: RoomTypeMix
    /** その日のタイプ別の実績。無ければ null */
    actual: { soldRooms: number | null; revenue: number | null } | null
  }
): Omit<T, keyof RoomTypeDayValues> & RoomTypeDayValues {
  const { count, hotelRooms, mix, actual } = ctx
  const sold = actual?.soldRooms ?? null
  const actualOccupancy = sold != null && count > 0 ? round3(sold / count) : null
  const actualAdr = sold != null && sold > 0 && actual?.revenue != null ? Math.round(actual.revenue / sold) : null

  // 配った室数はこのタイプの室数を超えない（稼働率と想定売上で同じ室数を使う）
  const predictedRooms =
    day.predictedOccupancy != null ? Math.min(count, Math.round(day.predictedOccupancy * hotelRooms * mix.roomShare)) : null
  const predictedOccupancy = predictedRooms != null && count > 0 ? round3(predictedRooms / count) : null
  const predictedAdr = day.predictedAdr != null ? Math.round(day.predictedAdr * mix.adrRatio) : null
  const expectedAdrBase = day.predictedAdr ?? day.recommendedPrice
  const expectedRevenue =
    predictedRooms != null && expectedAdrBase != null ? Math.round(predictedRooms * expectedAdrBase * mix.adrRatio) : null

  const values: RoomTypeDayValues = {
    budgetRooms: null,
    budgetOccupancy: null,
    budgetAdr: null,
    budgetRevenue: null,
    actualOccupancy,
    actualAdr,
    onHandRooms: sold,
    currentOccupancy: actualOccupancy,
    onHandAdr: actualAdr,
    currentRevenue: sold != null ? (actual?.revenue ?? null) : null,
    predictedOccupancy,
    predictedAdr,
    expectedRevenue,
  }
  return { ...day, ...values }
}
