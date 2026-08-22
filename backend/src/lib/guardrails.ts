import type { SyncPriceRankItem } from '@hotel-revenue-system/shared/types'

// 書き込みガードレール（docs/コネクタ連携設計.md §15）。
// 無人運転では人の承認という防波堤がないため、これが安全装置の主役になる。
// backend（ジョブ生成時・結果受理時）と connector-agent（実行直前）の両側で同じ制約を検査する。

export interface GuardrailConfig {
  /** 現在値からの変動幅上限（%）。超えたら価格ロジックの異常出力を疑う */
  maxChangePercent: number
  /** 1ジョブあたりの書き込み項目数上限 */
  maxItemsPerJob: number
  /** 料金ランクの最大段階数（F-SET-02） */
  maxRank: number
  /** 価格の上限（円）。桁誤り（0の打ち間違い等）の検出用 */
  maxPrice: number
}

export const DEFAULT_GUARDRAILS: GuardrailConfig = {
  maxChangePercent: 30,
  maxItemsPerJob: 100,
  maxRank: 40,
  maxPrice: 10_000_000,
}

export interface GuardrailViolation {
  rank: number | null
  field: string | null
  reason: string
}

const PRICE_FIELDS = ['price1P', 'price2P', 'price3P', 'price4P'] as const

function checkPriceValue(
  rank: number,
  field: string,
  value: number | null | undefined,
  required: boolean,
  cfg: GuardrailConfig,
  violations: GuardrailViolation[]
): void {
  if (value === null || value === undefined) {
    if (required) violations.push({ rank, field, reason: '必須の価格が未設定です' })
    return
  }
  if (!Number.isInteger(value) || value <= 0) {
    violations.push({ rank, field, reason: '価格は正の整数である必要があります' })
    return
  }
  if (value > cfg.maxPrice) {
    violations.push({ rank, field, reason: `価格が上限（${cfg.maxPrice.toLocaleString()}円）を超えています` })
  }
}

/**
 * 書き込みジョブの内容をガードレールと照合する。
 * currentByRank はシステムが把握している現在値（変動幅チェックの基準）。
 * 現在値が無いランク（新規設定）は変動幅チェックをスキップし、値域チェックのみ行う。
 */
export function checkWriteGuardrails(
  items: SyncPriceRankItem[],
  currentByRank: ReadonlyMap<number, SyncPriceRankItem>,
  cfg: GuardrailConfig = DEFAULT_GUARDRAILS
): { ok: boolean; violations: GuardrailViolation[] } {
  const violations: GuardrailViolation[] = []

  if (items.length === 0) {
    violations.push({ rank: null, field: null, reason: '書き込み項目が空です' })
  }
  if (items.length > cfg.maxItemsPerJob) {
    violations.push({
      rank: null,
      field: null,
      reason: `書き込み項目数が上限（${cfg.maxItemsPerJob}件）を超えています: ${items.length}件`,
    })
  }

  const seenRanks = new Set<number>()
  for (const item of items) {
    if (!Number.isInteger(item.rank) || item.rank < 1 || item.rank > cfg.maxRank) {
      violations.push({ rank: item.rank, field: 'rank', reason: `ランクは1〜${cfg.maxRank}の整数である必要があります` })
      continue
    }
    if (seenRanks.has(item.rank)) {
      violations.push({ rank: item.rank, field: 'rank', reason: '同一ランクが重複しています' })
      continue
    }
    seenRanks.add(item.rank)

    checkPriceValue(item.rank, 'price1P', item.price1P, true, cfg, violations)
    checkPriceValue(item.rank, 'price2P', item.price2P, true, cfg, violations)
    checkPriceValue(item.rank, 'price3P', item.price3P, false, cfg, violations)
    checkPriceValue(item.rank, 'price4P', item.price4P, false, cfg, violations)

    const current = currentByRank.get(item.rank)
    if (!current) continue

    for (const field of PRICE_FIELDS) {
      const next = item[field]
      const prev = current[field]
      if (next === null || next === undefined || prev === null || prev === undefined || prev <= 0) continue
      const changePercent = (Math.abs(next - prev) / prev) * 100
      if (changePercent > cfg.maxChangePercent) {
        violations.push({
          rank: item.rank,
          field,
          reason: `変動幅が上限（±${cfg.maxChangePercent}%）を超えています: ${prev.toLocaleString()}円 → ${next.toLocaleString()}円`,
        })
      }
    }
  }

  return { ok: violations.length === 0, violations }
}
