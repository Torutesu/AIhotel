// 価格反応モデル（docs/外部要因設計.md §2.3）。
//
// 需要予測 D は「基準ランク r_D の価格 p_ref で売ったときの稼働率」と解釈する。
// 支払意思額（WTP）が対数正規分布に従うと仮定し、価格 p での受容率を
//   S(p) = 1 - Φ((ln(p / p_ref) - μ) / σ)
// とする。μ は「p_ref で潜在需要の 80% が受け入れる」かつ「価格制約なしの
// 収益最大点がちょうど p_ref になる」ように σ から決める（hazard(z*) = σ の解 z* を使う）。
// これにより、需要が弱いときは基準ランクが収益最適（下げても増収しない）、
// 需要が強い（潜在需要が客室数を超える）ときは満室を保てる範囲で値上げが最適、
// という直感どおりの振る舞いになる。σ はホテル別に学習可能（'price:sigma'）。

const ACCEPTANCE_AT_REFERENCE = 0.8

/** 標準正規分布の累積分布関数（Abramowitz & Stegun 7.1.26 による erf 近似、誤差 1.5e-7） */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2)
  return 0.5 * (1 + (x >= 0 ? y : -y))
}

/** 標準正規分布の分位点（Φ^-1）。二分法で十分な精度 */
export function normalQuantile(p: number): number {
  let lo = -8
  let hi = 8
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (normalCdf(mid) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface PriceResponseModel {
  /** 基準価格（基準ランクの price1P） */
  referencePrice: number
  /** 基準価格で売ったときの稼働率（需要予測 D） */
  referenceOccupancy: number
  sigma: number
  /** 潜在需要（客室数比。1 を超えると基準価格で満室） */
  unconstrainedDemand: number
  mu: number
}

export function buildPriceResponse(referencePrice: number, referenceOccupancy: number, sigma: number): PriceResponseModel {
  const mu = -sigma * normalQuantile(1 - ACCEPTANCE_AT_REFERENCE)
  return {
    referencePrice,
    referenceOccupancy,
    sigma,
    unconstrainedDemand: referenceOccupancy / ACCEPTANCE_AT_REFERENCE,
    mu,
  }
}

/** 価格 p での受容率 S(p) */
export function acceptanceAt(model: PriceResponseModel, price: number): number {
  const z = (Math.log(price / model.referencePrice) - model.mu) / model.sigma
  return 1 - normalCdf(z)
}

/** 価格 p での予測稼働率（1.0 で頭打ち） */
export function occupancyAt(model: PriceResponseModel, price: number): number {
  return Math.min(1, Math.max(0, model.unconstrainedDemand * acceptanceAt(model, price)))
}

/** 価格 p での期待 RevPAR */
export function revParAt(model: PriceResponseModel, price: number): number {
  return price * occupancyAt(model, price)
}
