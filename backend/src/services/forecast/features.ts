// ======================================
// 需要予測の特徴量設計（4E-1 — docs/ai-agent-design.md §1, §2）
//
// 学習サンプルは1施設1年で約365行しかない（実測）。この規模では
// モデルの複雑さより**特徴量の質**が精度を決めるため、ここが本体になる。
//
// 設計上の絶対条件は「予測時点で知り得ない値を入れない」こと。
// 宿泊日の実績や、予測時点より後に取得したオンハンドを混ぜると、
// 検証誤差だけが小さくなって本番で外れる（データリーク）。
// そのため FeatureContext は predictedAt を必ず受け取り、
// 各値の「いつ時点か」を型と命名で明示している。
// ======================================

/**
 * 特徴量の並び順。Ridge・GBM の双方がこの順の数値配列を受け取る。
 * MLOps画面で「どの特徴量の重みが動いたか」を出すためにも名前を持たせる。
 *
 * 並び順を変えると学習済みの重みが無意味になるため、
 * **末尾への追加のみ許可**し、途中への挿入・削除はしない（modelVersion を上げること）。
 */
export const FEATURE_NAMES = [
  // --- カレンダー（将来日でも確実に分かる） ---
  'dow_sun',
  'dow_mon',
  'dow_tue',
  'dow_wed',
  'dow_thu',
  'dow_fri',
  'dow_sat',
  'is_weekend',
  'season_sin',
  'season_cos',
  'is_holiday',
  'is_tokujitsu',
  'is_day_before_special',
  'is_day_after_special',
  // --- 予測地平 ---
  'lead_time_norm',
  'lead_time_log',
  // --- オンハンド（予測時点までに取得した断面のみ） ---
  'on_hand_occupancy',
  'on_hand_vs_last_year',
  'pickup_7d',
  'remaining_ratio',
  // --- 実績履歴 ---
  'same_weekday_ma28',
  'year_over_year_occupancy',
  'trailing_7d_occupancy',
  // --- 外部要因 ---
  'external_impact_sum',
  'external_factor_count',
] as const

export type FeatureName = (typeof FEATURE_NAMES)[number]
export const FEATURE_COUNT = FEATURE_NAMES.length

/**
 * 特徴量を組み立てるために必要な、予測時点で判明している情報。
 *
 * null は「その情報が無い」を意味し、欠損として扱う（0埋めではない — §欠損の扱い）。
 */
export interface FeatureContext {
  /** 予測対象の宿泊日 */
  stayDate: Date
  /** いつ時点の予測か。ここより後の情報は一切使ってはいけない */
  predictedAt: Date
  /** 週末とみなす曜日（Hotel.weekendDays。金土などホテルごとに異なる） */
  weekendDays: number[]

  /** 特日マスタ由来 */
  isHoliday: boolean
  isTokujitsu: boolean
  /** 前日・翌日が特日か（前泊・後泊需要を捉える） */
  isDayBeforeSpecial: boolean
  isDayAfterSpecial: boolean

  /** predictedAt 時点のオンハンド稼働率（0〜1）。断面が無ければ null */
  onHandOccupancy: number | null
  /** 前年同日・同リードタイムのオンハンド稼働率（0〜1）。無ければ null */
  onHandLastYearSameLead: number | null
  /** 直近7日で積み上がった稼働率（pickup）。断面が2つ以上ないと出せない */
  pickup7d: number | null
  /** predictedAt 時点の残室率（0〜1）。無ければ null */
  remainingRatio: number | null

  /** 直近28日の同曜日平均稼働率（実績ベース）。無ければ null */
  sameWeekdayMa28: number | null
  /** 前年同時期の稼働率。無ければ null */
  yearOverYearOccupancy: number | null
  /** 直近7日の平均稼働率。無ければ null */
  trailing7dOccupancy: number | null

  /** 宿泊日に重なる外部要因の impactScore 合計（-1〜1想定・未設定は0扱い） */
  externalImpactSum: number
  /** 宿泊日に重なる外部要因の件数 */
  externalFactorCount: number
}

/**
 * 欠損の扱い。
 *
 * 稼働率系の特徴量は「0」が正当な値（稼働率0%）なので、欠損を0で埋めると
 * 「まだデータが無い」と「本当に空っぽ」を区別できなくなる。
 * そこで欠損は 0 で埋めたうえで、**欠損フラグを別特徴量として持たせる**……
 * のが定石だが、特徴量数を倍にすると数百行のデータでは過学習が増える。
 *
 * ここでは代わりに **中央値相当の既定値（0.5）で埋める**。
 * 稼働率の分布の中心に置くことで、欠損が予測を極端に引っ張らない。
 */
const MISSING_OCCUPANCY_FALLBACK = 0.5

/** 予測地平の正規化に使う上限。仕様の180日先予測に合わせる */
export const MAX_LEAD_TIME_DAYS = 180

const MS_PER_DAY = 86_400_000

/** UTC日付同士の日数差（時刻成分は無視する） */
export function diffDays(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / MS_PER_DAY)
}

/** 0〜1に丸める。学習前の異常値がモデルを壊さないようにする */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return MISSING_OCCUPANCY_FALLBACK
  return Math.min(1, Math.max(0, value))
}

function orFallback(value: number | null): number {
  return value == null ? MISSING_OCCUPANCY_FALLBACK : clamp01(value)
}

/**
 * 年内の位置を円周上に写す（12月31日と1月1日を近い値にするため）。
 * 月番号をそのまま入れると年をまたぐところで不連続になる。
 */
export function seasonCycle(date: Date): { sin: number; cos: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const end = Date.UTC(date.getUTCFullYear() + 1, 0, 1)
  const progress = (date.getTime() - start) / (end - start)
  const angle = 2 * Math.PI * progress
  return { sin: Math.sin(angle), cos: Math.cos(angle) }
}

/**
 * FeatureContext を数値配列にする。純関数（DBに触らない）。
 *
 * 返す配列の長さは必ず FEATURE_COUNT で、並びは FEATURE_NAMES と一致する。
 */
export function buildFeatureVector(ctx: FeatureContext): number[] {
  const dow = ctx.stayDate.getUTCDay()
  const season = seasonCycle(ctx.stayDate)
  const leadTime = Math.max(0, diffDays(ctx.predictedAt, ctx.stayDate))

  const onHand = orFallback(ctx.onHandOccupancy)
  // 前年比は「今年 ÷ 前年」。前年が0や欠損なら中立の1.0にする
  const onHandVsLastYear =
    ctx.onHandOccupancy != null && ctx.onHandLastYearSameLead != null && ctx.onHandLastYearSameLead > 0
      ? Math.min(3, ctx.onHandOccupancy / ctx.onHandLastYearSameLead)
      : 1

  const features: number[] = [
    dow === 0 ? 1 : 0,
    dow === 1 ? 1 : 0,
    dow === 2 ? 1 : 0,
    dow === 3 ? 1 : 0,
    dow === 4 ? 1 : 0,
    dow === 5 ? 1 : 0,
    dow === 6 ? 1 : 0,
    ctx.weekendDays.includes(dow) ? 1 : 0,
    season.sin,
    season.cos,
    ctx.isHoliday ? 1 : 0,
    ctx.isTokujitsu ? 1 : 0,
    ctx.isDayBeforeSpecial ? 1 : 0,
    ctx.isDayAfterSpecial ? 1 : 0,
    Math.min(1, leadTime / MAX_LEAD_TIME_DAYS),
    Math.log1p(leadTime) / Math.log1p(MAX_LEAD_TIME_DAYS),
    onHand,
    onHandVsLastYear,
    // pickup は 0 が正当な値（1週間動きが無かった）なので欠損も0でよい
    ctx.pickup7d == null ? 0 : clamp01(ctx.pickup7d),
    orFallback(ctx.remainingRatio),
    orFallback(ctx.sameWeekdayMa28),
    orFallback(ctx.yearOverYearOccupancy),
    orFallback(ctx.trailing7dOccupancy),
    // impactScore は -1〜1 想定。範囲外は丸める
    Math.min(3, Math.max(-3, ctx.externalImpactSum)),
    Math.min(10, ctx.externalFactorCount),
  ]

  // 並び順のズレは学習済み重みを無意味にするため、開発時点で必ず落とす
  if (features.length !== FEATURE_COUNT) {
    throw new Error(
      `特徴量の数が定義と一致しません（実装 ${features.length} / 定義 ${FEATURE_COUNT}）`
    )
  }
  return features
}

/** 学習・検証で使う1サンプル */
export interface TrainingSample {
  features: number[]
  /** 実績稼働率（0〜1） */
  target: number
  /** 時系列分割に使う。宿泊日で並べる */
  stayDate: Date
}

/**
 * 時系列で学習・検証に分ける。
 *
 * 需要予測でランダム分割をすると、未来のデータで過去を予測する形になり、
 * 検証誤差が実力より良く出る。必ず**時間で切る**。
 */
export function splitByTime(
  samples: TrainingSample[],
  validationRatio = 0.2
): { train: TrainingSample[]; validation: TrainingSample[] } {
  const sorted = [...samples].sort((a, b) => a.stayDate.getTime() - b.stayDate.getTime())
  const cut = Math.floor(sorted.length * (1 - validationRatio))
  // 検証が空になると「誤差0で最良」と誤判定するため、最低1件は確保する
  const safeCut = Math.min(cut, Math.max(0, sorted.length - 1))
  return { train: sorted.slice(0, safeCut), validation: sorted.slice(safeCut) }
}
