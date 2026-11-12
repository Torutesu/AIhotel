"use client"

// AI 推奨の根拠（#24 E4・D-11）。以前は日別の詳細情報ダイアログ（タイプ別人数別カレンダーのセルから開く）にあった。
// 2026-10-24 にカレンダー表示を外したため、表の行から開く 日のAI分析 に移した。

import { Badge } from "@/components/ui/badge"
import { BUDGET_SOURCE_LABELS } from "@/components/pricing/pricing-constants"
import type { PricingCalendarDay, RecommendationRationale } from "@/lib/api"
import { formatPercent as pct, formatRooms, formatYen as yen } from "@/lib/format"


const FACTOR_LABELS: Record<RecommendationRationale["factors"][number]["key"], string> = {
  occupancy: "稼働率",
  adr: "ADR",
  competitor: "競合価格",
}

const EXCLUDED_REASONS: Record<RecommendationRationale["excluded"][number]["reason"], string> = {
  no_data: "データが無いため使っていません",
  stale: "取得から48時間を超えて古いため使っていません",
  zero_weight: "重みが0%のため使っていません",
}

const GUARDRAIL_LABELS: Record<RecommendationRationale["guardrails"][number]["key"], string> = {
  minRank: "推奨ランクの下限",
  maxRank: "推奨ランクの上限",
  periodMinRank: "期間で決めた価格の幅（下限）",
  periodMaxRank: "期間で決めた価格の幅（上限）",
  maxDailyChange: "1回の変動幅",
  hysteresis: "据え置き（前回との差が小さい）",
}

const ADJUSTMENT_LABELS: Record<RecommendationRationale["adjustments"][number]["key"], string> = {
  event: "イベント",
  weekend: "週末",
  pace: "予約の入り方",
  otbFloor: "予約済みの室数",
  pattern: "似た日の着地",
  coldStart: "実績が少ないためホテルタイプの典型で補った分",
  market: "市場の動き（インバウンド・アクセスなど）",
}

/** 日の予算（室数・売上）と、その出どころ（D-13）。予算が無ければ何も出さない */
export function DayBudgetLine({ day }: { day: Pick<PricingCalendarDay, "budgetRooms" | "budgetRevenue" | "budgetSource"> }) {
  if (day.budgetRooms == null && day.budgetRevenue == null) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm" data-testid="day-budget">
      <span>
        この日の予算：{formatRooms(day.budgetRooms)}・{yen(day.budgetRevenue)}
      </span>
      {day.budgetSource && (
        <Badge variant="outline" className="text-[10px]">
          {BUDGET_SOURCE_LABELS[day.budgetSource]}
        </Badge>
      )}
    </div>
  )
}

type BudgetStance = NonNullable<RecommendationRationale["budget"]>

export const BUDGET_STANCE_LABELS: Record<BudgetStance["stance"], string> = {
  onTrack: "予算どおり",
  chase: "予算を追う（稼働寄り）",
  giveUp: "未達前提で売上を最大化",
}

/** 月の予算への向き合い方（D-13）を一文にする。gap = 予算 − 着地見込み（正なら不足） */
export function budgetStanceNote(budget: BudgetStance): string {
  const gap = Math.abs(Math.round(budget.gap))
  if (budget.stance === "onTrack") {
    return budget.gap < 0 ? `着地見込みが月の予算を ${yen(gap)} 上回っています。` : "着地見込みが月の予算に届いています。"
  }
  if (budget.stance === "chase") {
    return `月の予算まで ${yen(gap)} 足りないため、日の優先モデルを1段稼働寄りにしています。`
  }
  return `月の予算まで ${yen(gap)} 足りず、残りの期間では届かない見込みのため、予算は追わずに売上が最大になる価格にしています。`
}

/** 補正の材料を一文にする（似た日の着地・市場の動き・実績が少ないホテルの補い — D-13）。材料が無ければ null */
export function adjustmentNote(adjustment: RecommendationRationale["adjustments"][number]): string | null {
  const input = adjustment.input
  if (!input) return null
  if (adjustment.key === "pattern") {
    const parts: string[] = []
    if (typeof input.neighbors === "number") parts.push(`背景と入り方の近い過去の${input.neighbors}日`)
    if (typeof input.patternOccupancy === "number") parts.push(`の着地は稼働${pct(input.patternOccupancy)}`)
    if (typeof input.pickupRooms === "number") parts.push(`（今から${Math.round(input.pickupRooms)}室入る見込み）`)
    if (parts.length === 0) return null
    const weight = typeof input.weight === "number" ? `。予測に${Math.round(input.weight * 100)}%の割合で混ぜています` : ""
    return `似た日の着地：${parts.join("")}${weight}。`
  }
  if (adjustment.key === "market") {
    return typeof input.signals === "number" ? `市場の動き：外部要因エージェントが集めた${input.signals}件の動きを稼働率予測に反映しています（±6pt まで）。` : null
  }
  if (adjustment.key === "coldStart") {
    const base = typeof input.baseOccupancy === "number" ? `稼働${pct(input.baseOccupancy)}` : null
    if (input.method === "extrapolated") {
      return `実績が少ないため、ホテルタイプの典型的な予約の入り方で今の予約から着地を引き延ばしています${base ? `（${base}）` : ""}。`
    }
    return `実績が少ないため、ホテルタイプの典型的な稼働率を使っています${base ? `（${base}）` : ""}。`
  }
  return null
}

/** 予約の入り方（D-11）の材料を一文にする。材料が無ければ null */
export function paceNote(rationale: RecommendationRationale): string | null {
  const pace = rationale.adjustments.find((a) => a.key === "pace" || a.key === "otbFloor")
  const input = pace?.input
  if (!pace || !input) return null
  const lead = typeof input.leadDays === "number" ? `残り${input.leadDays}日で` : ""
  const otb = typeof input.otbRooms === "number" ? `${input.otbRooms}室` : null
  if (pace.key === "otbFloor") {
    return otb ? `${lead}すでに${otb}の予約があるため、それを下回る稼働率は予測していません。` : null
  }
  const lastYear = typeof input.lastYearOtbRooms === "number" ? `${input.lastYearOtbRooms}室` : null
  const ratio = typeof input.ratio === "number" ? `${Math.round(input.ratio * 100)}%` : null
  if (!otb || !lastYear || !ratio) return null
  return `${lead}${otb}の予約（前年同曜日の同じ時点は${lastYear}、ペース${ratio}）。宿泊日が近いほど予約の入り方を重く見ます。`
}

/** 推奨理由（#24 E4）。なぜこのランクを推奨したかを、観点ごとのランクと重みで示す */
export function RationaleSection({ rationale }: { rationale: RecommendationRationale }) {
  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <div className="font-medium">推奨の根拠</div>
      <ul className="space-y-1">
        {rationale.factors.map((f) => (
          <li key={f.key} className="flex flex-wrap justify-between gap-2">
            <span>{FACTOR_LABELS[f.key]}から見たランク：{f.rank}</span>
            <span className="tabular-nums text-muted-foreground">重み {f.weight}%</span>
          </li>
        ))}
        {rationale.excluded.map((e) => (
          <li key={e.key} className="text-xs text-muted-foreground">
            {FACTOR_LABELS[e.key]}：{EXCLUDED_REASONS[e.reason]}
          </li>
        ))}
      </ul>
      {rationale.adjustments.length > 0 && (
        <p className="text-xs text-muted-foreground">
          稼働率予測の補正：
          {rationale.adjustments
            .map((a) => `${ADJUSTMENT_LABELS[a.key]} ${a.impact > 0 ? "+" : ""}${Math.round(a.impact * 100)}pt`)
            .join("、")}
        </p>
      )}
      {paceNote(rationale) && <p className="text-xs text-muted-foreground">{paceNote(rationale)}</p>}
      {rationale.adjustments.map((a) => {
        const note = adjustmentNote(a)
        return note ? (
          <p key={a.key} className="text-xs text-muted-foreground">
            {note}
          </p>
        ) : null
      })}
      {rationale.budget && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="budget-stance">
          <span>月の予算：</span>
          <Badge variant="outline" className="text-[10px]">
            {BUDGET_STANCE_LABELS[rationale.budget.stance]}
          </Badge>
          <span>{budgetStanceNote(rationale.budget)}</span>
        </p>
      )}
      {rationale.guardrails.length > 0 && (
        <p className="text-xs text-muted-foreground">
          調整：
          {rationale.guardrails.map((g) => `${GUARDRAIL_LABELS[g.key]}でランク${g.from}→${g.to}`).join("、")}
        </p>
      )}
    </div>
  )
}
