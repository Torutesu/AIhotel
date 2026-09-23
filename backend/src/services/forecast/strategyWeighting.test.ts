import { describe, it, expect } from 'vitest'
import {
  COMPETITOR_PRICE_MAX_AGE_HOURS,
  OCCUPANCY_ONLY_WEIGHTS,
  applyRankGuardrails,
  blendRanksByStrategy,
  computeAdrRank,
  computeCompetitorRank,
  computePredictedAdr,
  mapPriceToRank,
  resolveCompetitorOccupancy,
  type AdrRecord,
  type CompetitorPriceRecord,
  type RankPrice,
} from './strategyWeighting.js'

// UTC固定の日付ヘルパー（タイムゾーン依存の失敗を避ける）
function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

// rank 1 = 10000円, rank 2 = 20000円 ... rank 5 = 50000円
const RANKS: RankPrice[] = [1, 2, 3, 4, 5].map((rank) => ({ rank, price: rank * 10_000 }))

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
  const NOW = new Date('2026-07-01T12:00:00Z')
  const fresh = new Date('2026-07-01T03:00:00Z') // 9時間前
  const opts = { now: NOW }

  it('対象日の競合価格の中央値に対応するランクを返す', () => {
    const target = d(2026, 7, 10)
    const prices: CompetitorPriceRecord[] = [
      { date: target, price: 20_000, observedAt: fresh },
      { date: target, price: 40_000, observedAt: fresh },
      { date: d(2026, 7, 11), price: 50_000, observedAt: fresh }, // 別日 → 除外
    ]
    const result = computeCompetitorRank(prices, target, RANKS, opts)
    expect(result).toMatchObject({ rank: 3, median: 30_000, count: 2, excluded: null })
  })

  it('1社だけ極端に高くても中央値なので引きずられない', () => {
    const target = d(2026, 7, 10)
    const prices: CompetitorPriceRecord[] = [
      { date: target, price: 20_000, observedAt: fresh },
      { date: target, price: 21_000, observedAt: fresh },
      { date: target, price: 200_000, observedAt: fresh },
    ]
    expect(computeCompetitorRank(prices, target, RANKS, opts).rank).toBe(2)
  })

  it('対象日の競合価格が無ければ null（no_data）を返す', () => {
    const target = d(2026, 7, 10)
    const prices: CompetitorPriceRecord[] = [{ date: d(2026, 7, 11), price: 50_000, observedAt: fresh }]
    expect(computeCompetitorRank(prices, target, RANKS, opts)).toMatchObject({ rank: null, excluded: 'no_data' })
  })

  it(`取得から${COMPETITOR_PRICE_MAX_AGE_HOURS}時間を超えた値は使わない（#9）`, () => {
    const target = d(2026, 7, 10)
    const stale = new Date(NOW.getTime() - (COMPETITOR_PRICE_MAX_AGE_HOURS + 1) * 3_600_000)
    const prices: CompetitorPriceRecord[] = [
      { date: target, price: 50_000, observedAt: stale },
      { date: target, price: 20_000, observedAt: fresh },
    ]
    expect(computeCompetitorRank(prices, target, RANKS, opts)).toMatchObject({ rank: 2, count: 1 })
    expect(computeCompetitorRank([prices[0]], target, RANKS, opts)).toMatchObject({ rank: null, excluded: 'stale' })
  })

  it('相対ポジション: +50% なら中央値の1.5倍に近いランクを狙う（#17）', () => {
    const target = d(2026, 7, 10)
    const prices: CompetitorPriceRecord[] = [{ date: target, price: 20_000, observedAt: fresh }]
    expect(computeCompetitorRank(prices, target, RANKS, { ...opts, offsetPct: 50 }).rank).toBe(3)
    expect(computeCompetitorRank(prices, target, RANKS, { ...opts, offsetPct: -50 }).rank).toBe(1)
  })
})

describe('applyRankGuardrails (#17)', () => {
  const base = { minRank: null, maxRank: null, maxDailyRankChange: 3, hysteresisRanks: 1 }

  it('前回との差がヒステリシス以内なら前回のまま据え置く', () => {
    const result = applyRankGuardrails({ rank: 11, previousRank: 10, guardrails: base, maxRank: 40 })
    expect(result).toEqual({ rank: 10, applied: [{ key: 'hysteresis', from: 11, to: 10 }] })
  })

  it('前回から動かせるのは maxDailyRankChange まで', () => {
    expect(applyRankGuardrails({ rank: 20, previousRank: 10, guardrails: base, maxRank: 40 }).rank).toBe(13)
    expect(applyRankGuardrails({ rank: 2, previousRank: 10, guardrails: base, maxRank: 40 }).rank).toBe(7)
  })

  it('下限・上限は最後に必ずかかる（前回の推奨が無い初回も）', () => {
    const g = { ...base, minRank: 5, maxRank: 30 }
    expect(applyRankGuardrails({ rank: 2, previousRank: null, guardrails: g, maxRank: 40 })).toEqual({
      rank: 5,
      applied: [{ key: 'minRank', from: 2, to: 5 }],
    })
    expect(applyRankGuardrails({ rank: 35, previousRank: null, guardrails: g, maxRank: 40 }).rank).toBe(30)
    // 上限は料金ランクの最大値も超えない
    expect(applyRankGuardrails({ rank: 50, previousRank: null, guardrails: { ...base, maxRank: 45 }, maxRank: 40 }).rank).toBe(40)
  })

  it('制限なし・ヒステリシス0なら計算どおり', () => {
    const g = { minRank: null, maxRank: null, maxDailyRankChange: null, hysteresisRanks: 0 }
    expect(applyRankGuardrails({ rank: 30, previousRank: 10, guardrails: g, maxRank: 40 })).toEqual({ rank: 30, applied: [] })
  })
})

describe('resolveCompetitorOccupancy (#17)', () => {
  it('設定があればそれを使い、無ければホテルタイプから決める', () => {
    expect(resolveCompetitorOccupancy(2, 'LIMITED_SERVICE')).toBe(2)
    expect(resolveCompetitorOccupancy(null, 'LIMITED_SERVICE')).toBe(1)
    expect(resolveCompetitorOccupancy(null, 'RYOKAN')).toBe(2)
    expect(resolveCompetitorOccupancy(null, 'RESORT')).toBe(2)
    expect(resolveCompetitorOccupancy(null, null)).toBe(1)
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

describe('computePredictedAdr', () => {
  it('推奨ランクへの1名料金の変化率を実績ADRに掛ける', () => {
    // 実績ADR 30000 → 基準ランク3(30000)。推奨ランク4(40000)なら 4/3 倍
    expect(computePredictedAdr({ baseAdr: 30_000, recommendedRank: 4, ranks: RANKS })).toBe(40_000)
    // 実績ADR 33000（基準ランク3）→ 推奨ランク2 なら 2/3 倍
    expect(computePredictedAdr({ baseAdr: 33_000, recommendedRank: 2, ranks: RANKS })).toBe(22_000)
  })

  it('料金ランクが無ければ実績ADRをそのまま返す', () => {
    expect(computePredictedAdr({ baseAdr: 18_500.4, recommendedRank: 3, ranks: [] })).toBe(18_500)
  })

  it('ADR実績が無ければ null を返す', () => {
    expect(computePredictedAdr({ baseAdr: null, recommendedRank: 3, ranks: RANKS })).toBeNull()
  })
})
