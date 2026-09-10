// 予測と推奨の評価（docs/外部要因設計.md §5.3, §6）。DB 非依存の純粋ロジック。
//   - アブレーション: 要因グループを外したときの精度変化（要因は clamp 前に加法的なので再予測不要）
//   - 要因別成績表: 要因が効いた日の残差の傾向（過小／過大評価の判定）
//   - 推奨効果: 採用日／上書き日／未判断日の RevPAR を需要レベル帯で条件を揃えて比較
import { factorGroup, type RidgeFeatureKey } from './ridge.js'
import { factorLabel, leadBucket } from './factorDefaults.js'
import type { DemandFactor } from './demandModel.js'

export interface EvaluationSample {
  stayDate: string
  leadDays: number
  predictedOccupancy: number
  unconstrainedOccupancy: number
  actualOccupancy: number
  demandFactors: DemandFactor[]
}

function mape(pairs: Array<{ predicted: number; actual: number }>): number {
  if (pairs.length === 0) return 0
  return pairs.reduce((s, p) => s + Math.abs(p.actual - p.predicted) / Math.max(p.actual, 0.2), 0) / pairs.length
}

export const ABLATION_GROUPS: Array<{ group: RidgeFeatureKey; label: string }> = [
  { group: 'pace', label: '予約ペース' },
  { group: 'holiday', label: '祝日・連休' },
  { group: 'special', label: '特別期間（GW・お盆・年末年始）' },
  { group: 'school', label: '学校休暇' },
  { group: 'event', label: 'イベント' },
  { group: 'weather', label: '天候' },
  { group: 'comp', label: '競合（相対価格・売止め）' },
  { group: 'weekend', label: '週末（ホテル定義）' },
]

export interface AblationRow {
  group: string
  label: string
  /** その要因が効いた日数 */
  activeDays: number
  mapeWith: number
  mapeWithout: number
  /** 正 = 要因が精度に貢献（外すと悪化） */
  contribution: number
}

/**
 * 各要因グループを外したときの MAPE を、保存済みの要因分解から再計算する
 */
export function summarizeAblation(samples: EvaluationSample[]): AblationRow[] {
  const withAll = mape(samples.map((s) => ({ predicted: s.predictedOccupancy, actual: s.actualOccupancy })))
  return ABLATION_GROUPS.map(({ group, label }) => {
    let activeDays = 0
    const pairs = samples.map((s) => {
      const removed = s.demandFactors.filter((f) => factorGroup(f.key) === group).reduce((sum, f) => sum + f.pt, 0)
      if (removed !== 0) activeDays++
      const predicted = Math.min(1, Math.max(0, s.unconstrainedOccupancy - removed))
      return { predicted, actual: s.actualOccupancy }
    })
    const without = mape(pairs)
    return { group, label, activeDays, mapeWith: withAll, mapeWithout: without, contribution: without - withAll }
  })
}

export interface FactorScorecardRow {
  key: string
  label: string
  group: string | null
  /** 要因が効いた日数（リードタイム 1〜14 日のサンプル） */
  samples: number
  /** 現在の係数（pt）。pace/comp:price_index など可変寄与のキーは平均寄与 */
  assumedPt: number
  /** その日の残差（実績 − 予測）の平均。正なら過小評価 */
  meanResidualPt: number
  /** 残差が正だった割合 */
  positiveShare: number
  verdict: '過小評価' | '過大評価' | '妥当' | 'データ不足'
}

const SCORECARD_MIN_SAMPLES = 5
const SCORECARD_TOLERANCE_PT = 0.03

/**
 * 要因キーごとに、効いた日の残差の傾向をまとめる
 */
export function summarizeFactorScorecard(samples: EvaluationSample[], coefficients: ReadonlyMap<string, number>): FactorScorecardRow[] {
  const byKey = new Map<string, { residuals: number[]; pts: number[] }>()
  for (const s of samples) {
    if (s.leadDays < 1 || s.leadDays > 14) continue
    const residual = s.actualOccupancy - s.predictedOccupancy
    for (const f of s.demandFactors) {
      if (f.key === 'base') continue
      const e = byKey.get(f.key) ?? { residuals: [], pts: [] }
      e.residuals.push(residual)
      e.pts.push(f.pt)
      byKey.set(f.key, e)
    }
  }
  const rows: FactorScorecardRow[] = []
  for (const [key, e] of byKey) {
    const n = e.residuals.length
    const mean = e.residuals.reduce((a, b) => a + b, 0) / n
    const positive = e.residuals.filter((r) => r > 0).length / n
    const fixed = coefficients.get(key)
    const assumedPt = key === 'pace' || key === 'comp:price_index' || key === 'comp:soldout_share' || fixed == null ? e.pts.reduce((a, b) => a + b, 0) / n : fixed
    let verdict: FactorScorecardRow['verdict'] = 'データ不足'
    if (n >= SCORECARD_MIN_SAMPLES) {
      verdict = mean > SCORECARD_TOLERANCE_PT ? '過小評価' : mean < -SCORECARD_TOLERANCE_PT ? '過大評価' : '妥当'
    }
    rows.push({ key, label: factorLabel(key), group: factorGroup(key), samples: n, assumedPt, meanResidualPt: mean, positiveShare: positive, verdict })
  }
  return rows.sort((a, b) => b.samples - a.samples)
}

export type DecisionOutcome = 'adopted' | 'overridden' | 'none'

export interface EffectSample {
  stayDate: string
  demandLevel: 'A' | 'B' | 'C' | 'D' | 'E'
  outcome: DecisionOutcome
  revPar: number | null
  occupancy: number | null
  adr: number | null
}

export interface EffectGroupStats {
  days: number
  avgRevPar: number | null
  avgOccupancy: number | null
  avgAdr: number | null
}

export interface EffectRow {
  demandLevel: string
  adopted: EffectGroupStats
  overridden: EffectGroupStats
  none: EffectGroupStats
  /** 採用日 − 上書き日 の RevPAR 差（両方に日があるときだけ） */
  revParDiffAdoptedVsOverridden: number | null
}

function stats(list: EffectSample[]): EffectGroupStats {
  const avg = (vals: Array<number | null>) => {
    const v = vals.filter((x): x is number => x != null)
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  return { days: list.length, avgRevPar: avg(list.map((s) => s.revPar)), avgOccupancy: avg(list.map((s) => s.occupancy)), avgAdr: avg(list.map((s) => s.adr)) }
}

/**
 * 需要レベル帯ごとに採用／上書き／未判断の実績を比べる。
 * 採用される日には偏りがあるため、同じ需要レベル帯の中でのみ比較する（docs/外部要因設計.md §6）
 */
export function summarizeRecommendationEffect(samples: EffectSample[]): { rows: EffectRow[]; overall: EffectRow } {
  const build = (list: EffectSample[], level: string): EffectRow => {
    const adopted = stats(list.filter((s) => s.outcome === 'adopted'))
    const overridden = stats(list.filter((s) => s.outcome === 'overridden'))
    const none = stats(list.filter((s) => s.outcome === 'none'))
    return {
      demandLevel: level,
      adopted,
      overridden,
      none,
      revParDiffAdoptedVsOverridden:
        adopted.avgRevPar != null && overridden.avgRevPar != null ? adopted.avgRevPar - overridden.avgRevPar : null,
    }
  }
  const rows = (['A', 'B', 'C', 'D', 'E'] as const).map((lvl) => build(samples.filter((s) => s.demandLevel === lvl), lvl)).filter((r) => r.adopted.days + r.overridden.days + r.none.days > 0)
  return { rows, overall: build(samples, 'ALL') }
}

export { leadBucket }
