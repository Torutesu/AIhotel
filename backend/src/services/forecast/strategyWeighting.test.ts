import { describe, it, expect } from 'vitest'
import {
  OCCUPANCY_ONLY_WEIGHTS,
  blendRanksByStrategy,
  computeAdrRank,
  computeCompetitorRank,
  mapPriceToRank,
  type AdrRecord,
  type CompetitorPriceRecord,
  type RankPrice,
} from './strategyWeighting.js'

// UTC固定の日付ヘルパー（タイムゾーン依存の失敗を避ける）
function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

// rank 1 = 10000円, rank 2 = 20000円 ... rank 5 = 50000円
const RANKS: RankPrice[] = [1, 2, 3, 4, 5].map((rank) => ({ rank, price1P: rank * 10_000 }))

describe('mapPriceToRank', () => {
  it('最も近い価格のランクを返す', () => {
    expect(mapPriceToRank(31_000, RANKS)).toBe(3)
    expect(mapPriceToRank(48_000, RANKS)).toBe(5)
  })

  it('同着の場合は安い側のランクを採用する（意図しない値上げ方向への丸めを防ぐ）', () => {
    // 15000 は rank1(10000) と rank2(20000) の中間
    expect(mapPriceToRank(15_000, RANKS)).toBe(1)
  })

  it('ランクが未設定なら null を返す', () => {
    expect(mapPriceToRank(10_000, [])).toBeNull()
  })
})

describe('computeAdrRank', () => {
  it('直近窓内の同曜日ADR平均に対応するランクを返す', () => {
    // target = 2026-07-10 (金)
    const target = d(2026, 7, 10)
    const history: AdrRecord[] = [
      { date: d(2026, 7, 3), adr: 40_000 }, // 金（窓内）
      { date: d(2026, 6, 26), adr: 40_000 }, // 金（窓内）
      { date: d(2026, 7, 9), adr: 10_000 }, // 木（曜日不一致 → 同曜日があるため不使用）
    ]
    expect(computeAdrRank(history, target, RANKS)).toBe(4)
  })

  it('同曜日の実績が無ければ窓内全体の平均にフォールバックする', () => {
    const target = d(2026, 7, 10)
    const history: AdrRecord[] = [
      { date: d(2026, 7, 8), adr: 20_000 }, // 水
      { date: d(2026, 7, 9), adr: 20_000 }, // 木
    ]
    expect(computeAdrRank(history, target, RANKS)).toBe(2)
  })

  it('窓内に実績が無ければ null を返す（ADR観点を合成から除外する）', () => {
    const target = d(2026, 7, 10)
    const history: AdrRecord[] = [{ date: d(2026, 1, 1), adr: 50_000 }]
    expect(computeAdrRank(history, target, RANKS)).toBeNull()
  })

  it('対象日以降の実績は使用しない', () => {
    const target = d(2026, 7, 10)
    const history: AdrRecord[] = [{ date: d(2026, 7, 11), adr: 50_000 }]
    expect(computeAdrRank(history, target, RANKS)).toBeNull()
  })
})

describe('computeCompetitorRank', () => {
  it('対象日の競合平均価格に対応するランクを返す', () => {
    const target = d(2026, 7, 10)
    const prices: CompetitorPriceRecord[] = [
      { date: target, price1P: 20_000 },
      { date: target, price1P: 40_000 },
      { date: d(2026, 7, 11), price1P: 50_000 }, // 別日 → 除外
    ]
    expect(computeCompetitorRank(prices, target, RANKS)).toBe(3)
  })

  it('対象日の競合価格が無ければ null を返す（競合観点を合成から除外する）', () => {
    const target = d(2026, 7, 10)
    const prices: CompetitorPriceRecord[] = [{ date: d(2026, 7, 11), price1P: 50_000 }]
    expect(computeCompetitorRank(prices, target, RANKS)).toBeNull()
  })
})

describe('blendRanksByStrategy', () => {
  it('3観点すべて揃っていれば重みどおりに加重平均する', () => {
    const result = blendRanksByStrategy({
      occupancyRank: 10,
      adrRank: 20,
      competitorRank: 30,
      weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
      maxRank: 40,
    })
    // (10*40 + 20*40 + 30*20) / 100 = 18
    expect(result.rank).toBe(18)
    expect(result.effectiveWeights).toEqual({ weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 })
  })

  it('重みを変えれば推奨ランクが変わる（F-DP-02 が価格算出に接続されていることの確認）', () => {
    const base = {
      occupancyRank: 10,
      adrRank: 30,
      competitorRank: 30,
      maxRank: 40,
    }
    const occupancyHeavy = blendRanksByStrategy({
      ...base,
      weights: { weightOccupancy: 100, weightAdr: 0, weightCompetitor: 0 },
    })
    const adrHeavy = blendRanksByStrategy({
      ...base,
      weights: { weightOccupancy: 0, weightAdr: 100, weightCompetitor: 0 },
    })

    expect(occupancyHeavy.rank).toBe(10)
    expect(adrHeavy.rank).toBe(30)
    expect(occupancyHeavy.rank).not.toBe(adrHeavy.rank)
  })

  it('データが無い観点は除外し、残りの重みを按分する', () => {
    const result = blendRanksByStrategy({
      occupancyRank: 10,
      adrRank: null, // ADR実績なし
      competitorRank: 30,
      weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
      maxRank: 40,
    })
    // ADRを除外 → 稼働率40 : 競合20 を按分 → (10*40 + 30*20) / 60 ≒ 16.67 → 17
    expect(result.rank).toBe(17)
    expect(result.components.adr).toBeNull()
    expect(result.effectiveWeights.weightAdr).toBe(0)
    expect(
      result.effectiveWeights.weightOccupancy + result.effectiveWeights.weightCompetitor
    ).toBe(100)
  })

  it('競合価格が無い日でもランクを引き下げない', () => {
    const withCompetitor = blendRanksByStrategy({
      occupancyRank: 30,
      adrRank: 30,
      competitorRank: 30,
      weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
      maxRank: 40,
    })
    const withoutCompetitor = blendRanksByStrategy({
      occupancyRank: 30,
      adrRank: 30,
      competitorRank: null,
      weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
      maxRank: 40,
    })
    expect(withoutCompetitor.rank).toBe(withCompetitor.rank)
  })

  it('有効な観点が1つも無ければ稼働率観点のランクを採用する', () => {
    const result = blendRanksByStrategy({
      occupancyRank: 25,
      adrRank: null,
      competitorRank: null,
      weights: { weightOccupancy: 0, weightAdr: 60, weightCompetitor: 40 },
      maxRank: 40,
    })
    expect(result.rank).toBe(25)
    expect(result.effectiveWeights).toEqual(OCCUPANCY_ONLY_WEIGHTS)
  })

  it('合成結果を 1〜maxRank にクランプする', () => {
    const high = blendRanksByStrategy({
      occupancyRank: 40,
      adrRank: 40,
      competitorRank: 40,
      weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
      maxRank: 10,
    })
    expect(high.rank).toBe(10)

    const low = blendRanksByStrategy({
      occupancyRank: 0,
      adrRank: 0,
      competitorRank: 0,
      weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
      maxRank: 40,
    })
    expect(low.rank).toBe(1)
  })
})
