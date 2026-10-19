// 月次予算の日割り（2026-10 デモ画面の修正 DP02 / DP04 / 日別パフォーマンス）。
//
// 予算は月単位で登録する（MonthlyBudget）。料金カレンダーや日別パフォーマンスで日ごとの予算と比べられるよう、
// 前年同曜日（364日前）の販売室数の比で日に配る。週末に多く、平日に少なく配られる。
//   - 予算ADR はその月の値をどの日にも使う（日ごとの単価の目標は持っていないため）
//   - 予算売上・予算室数は同じ比で配るので、日ごとの 売上 ÷ 室数 は月の予算ADRに一致する
//   - 前年の実績が無い日（特殊日を含む）は、実績がある日の平均の重みで配る。1日も無ければ均等に配る
//   - 1日の予算室数は客室数を上限にする（上限で切った分は他の日に回さない）
// DB に触れない純関数にしてテストで固定する。

export interface MonthBudgetInput {
  budgetRevenue: number | null
  budgetRooms: number | null
  budgetAdr: number | null
  budgetOccupancy: number | null
}

export interface DailyBudget {
  rooms: number | null
  occupancy: number | null
  adr: number | null
  revenue: number | null
  revPar: number | null
}

const EMPTY: DailyBudget = { rooms: null, occupancy: null, adr: null, revenue: null, revPar: null }

/** 月の予算室数。室数が無ければ稼働率×客室数×日数、それも無ければ売上÷ADR */
export function monthBudgetRooms(budget: MonthBudgetInput, totalRooms: number, days: number): number | null {
  if (budget.budgetRooms != null) return budget.budgetRooms
  if (budget.budgetOccupancy != null) return budget.budgetOccupancy * totalRooms * days
  if (budget.budgetRevenue != null && budget.budgetAdr != null && budget.budgetAdr > 0) {
    return budget.budgetRevenue / budget.budgetAdr
  }
  return null
}

/**
 * @param weights 日ごとの配分の重み（前年同曜日の販売室数）。並びは月の暦日順、長さは月の日数
 */
export function allocateDailyBudget(
  budget: MonthBudgetInput | null,
  totalRooms: number,
  weights: Array<number | null>
): DailyBudget[] {
  const days = weights.length
  if (!budget || days === 0 || totalRooms <= 0) return weights.map(() => EMPTY)

  const rooms = monthBudgetRooms(budget, totalRooms, days)
  const adr =
    budget.budgetAdr ??
    (budget.budgetRevenue != null && rooms != null && rooms > 0 ? budget.budgetRevenue / rooms : null)
  const revenue = budget.budgetRevenue ?? (rooms != null && adr != null ? rooms * adr : null)

  const known = weights.filter((w): w is number => w != null && w > 0)
  const fill = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1
  const filled = weights.map((w) => (w != null && w > 0 ? w : fill))
  const sum = filled.reduce((a, b) => a + b, 0)

  return filled.map((w) => {
    const share = w / sum
    const dayRooms = rooms == null ? null : Math.min(totalRooms, rooms * share)
    // 上限で切った日は売上も同じ割合で切る（ADR を月の値に保つ）
    const capRatio = rooms == null || rooms * share <= 0 ? 1 : (dayRooms as number) / (rooms * share)
    const dayRevenue = revenue == null ? null : revenue * share * capRatio
    return {
      rooms: dayRooms == null ? null : Math.round(dayRooms),
      occupancy: dayRooms == null ? null : Math.round((dayRooms / totalRooms) * 1000) / 1000,
      adr: adr == null ? null : Math.round(adr),
      revenue: dayRevenue == null ? null : Math.round(dayRevenue),
      revPar: dayRevenue == null ? null : Math.round(dayRevenue / totalRooms),
    }
  })
}
