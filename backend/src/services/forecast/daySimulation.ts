// 日単位のシミュレーション（2026-10 の画面修正 PDF b01「シミュレーションを日単位でできるよう、日のテーブルをクリックしたときに表示」）。
// 優先モデル（稼働優先・バランス・単価優先）や料金ランクを変えたときの、稼働・室数・売上の見込みを出す。保存はしない。
//
// 需要予測（ルールベース）の予測稼働率は価格に反応しないため、そのまま売上を比べると「価格を上げるほど売上が増える」ように見えてしまう。
// そこで価格弾力性（価格を1%上げると予約が何%減るか — 価格戦略の初期値）で、AI の推奨価格からの価格差に応じて稼働を増減させる。
// どの場合も、すでに予約が入っている室数（OTB）を下回らず、客室数を上回らない。DB 非依存の純関数。

export interface SimulateOccupancyInput {
  /** AI の推奨（今の優先モデル）での予測稼働率 */
  baseOccupancy: number
  /** AI の推奨（今の優先モデル）での単価 */
  basePrice: number
  /** 試算する単価 */
  price: number
  /** 価格弾力性（0 なら価格で稼働は変わらない） */
  elasticity: number
  totalRooms: number
  /** 今の予約室数（下限） */
  otbRooms: number | null
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** 価格を basePrice から price に変えたときの稼働の見込み */
export function simulateOccupancy(input: SimulateOccupancyInput): number {
  const { baseOccupancy, basePrice, price, elasticity, totalRooms, otbRooms } = input
  const floor = totalRooms > 0 && otbRooms != null ? Math.min(1, otbRooms / totalRooms) : 0
  if (basePrice <= 0 || price <= 0) return round3(Math.max(floor, Math.min(1, baseOccupancy)))
  const occupancy = baseOccupancy * Math.pow(price / basePrice, -elasticity)
  return round3(Math.max(floor, Math.min(1, occupancy)))
}

export interface SimulatedOutcome {
  occupancy: number
  rooms: number
  revenue: number
  revPar: number
}

/** 稼働の見込みから室数・売上・REV-Per を出す */
export function outcomeAt(occupancy: number, adr: number, totalRooms: number): SimulatedOutcome {
  const rooms = Math.round(occupancy * totalRooms)
  const revenue = Math.round(rooms * adr)
  return { occupancy, rooms, revenue, revPar: totalRooms > 0 ? Math.round(revenue / totalRooms) : 0 }
}
