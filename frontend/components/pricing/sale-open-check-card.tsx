"use client"

// 販売開始チェック（D-11）。
// IDeaS（G3）を使うホテルでは、先々（約11か月先）の月を毎月上旬に販売開始する前に、
// 人が「前年同月以上の ADR」を想定してシステムの初期提示額と突き合わせ、システムの金額が想定以上なら「リスクなし」として販売を始める。
// ここではその突き合わせを自動で行い、前年同曜日の ADR を割る日だけを一覧にする（推奨は保存しない試算）。

import { useMemo, useState } from "react"
import { CalendarCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { LabeledMonthPicker } from "@/components/month-picker"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type SaleOpenCheck } from "@/lib/api"
import { formatYen } from "@/lib/format"

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"]

/** 既定の対象月: 今日から11か月先（毎月上旬に販売を開始する月） */
export function defaultSaleOpenMonth(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() + 11, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export const VERDICT_LABELS: Record<SaleOpenCheck["summary"]["verdict"], { label: string; className: string }> = {
  ok: { label: "前年以上（販売開始のリスク小）", className: "bg-positive text-white" },
  review: { label: "前年割れの日があります（確認してから販売開始）", className: "bg-warning text-white" },
  insufficient: { label: "前年の実績が足りず判断できません", className: "bg-muted text-foreground" },
}

export function SaleOpenCheckCard() {
  const { hotelId } = useAuth()
  const [month, setMonth] = useState(defaultSaleOpenMonth)
  const [showAll, setShowAll] = useState(false)
  const [year, monthNumber] = month.split("-").map(Number)

  const { data, loading, error, reload } = useApiQuery<SaleOpenCheck>(
    hotelId ? () => api.saleOpenCheck(hotelId, year, monthNumber) : null,
    [hotelId, year, monthNumber],
    "販売開始チェックの取得に失敗しました",
  )

  const rows = useMemo(
    () => (data ? (showAll ? data.days : data.days.filter((d) => d.status === "below_last_year")) : []),
    [data, showAll],
  )

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <CalendarCheck className="h-4 w-4" aria-hidden />
              販売開始チェック
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              先々の月を販売開始する前に、AIの推奨（予測ADR）を前年同曜日・前年同月・予算のADRと突き合わせます。
              前年同曜日を割る日は、価格の幅の下限やイベント登録を見直してから販売を始めてください。推奨は保存しません。
            </p>
          </div>
          <LabeledMonthPicker id="sale-open-month" label="対象月" value={month} onChange={setMonth} yearOffsets={[0, 1, 2]} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error || !data ? (
          <ErrorState message={error ?? "販売開始チェックの取得に失敗しました"} onRetry={reload} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={VERDICT_LABELS[data.summary.verdict].className}>{VERDICT_LABELS[data.summary.verdict].label}</Badge>
              <span className="text-xs text-muted-foreground">
                比べられた {data.summary.comparableDays}日のうち前年割れ {data.summary.belowLastYearDays}日
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {[
                ["推奨の平均ADR", data.summary.averagePredictedAdr],
                ["前年同月のADR", data.summary.lastYearMonthAdr],
                ["予算ADR", data.summary.budgetAdr],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-md border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums font-medium">{formatYen(value as number | null)}</dd>
                </div>
              ))}
            </dl>

            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{showAll ? "すべての日" : "前年同曜日を割る日"}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "前年割れの日だけ表示" : "すべての日を表示"}
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {showAll ? "対象の日がありません。" : "前年同曜日のADRを割る日はありません。"}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">日付</th>
                      <th className="py-1.5 pr-2 font-medium">需要</th>
                      <th className="py-1.5 pr-2 font-medium">推奨</th>
                      <th className="py-1.5 pr-2 text-right font-medium">予測ADR</th>
                      <th className="py-1.5 pr-2 text-right font-medium">前年同曜日</th>
                      <th className="py-1.5 pr-2 text-right font-medium">差</th>
                      <th className="py-1.5 font-medium">イベント</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((day) => (
                      <tr key={day.date} className="border-b last:border-0">
                        <td className="whitespace-nowrap py-1.5 pr-2">
                          {day.date.slice(5).replace("-", "/")}（{WEEKDAY_LABELS[day.weekday]}）
                        </td>
                        <td className="py-1.5 pr-2">{day.demandLevel}</td>
                        <td className="py-1.5 pr-2">{day.recommendedRank != null ? `R${String(day.recommendedRank).padStart(2, "0")}` : "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{formatYen(day.predictedAdr)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{formatYen(day.lastYearAdr)}</td>
                        <td
                          className={`py-1.5 pr-2 text-right tabular-nums ${day.status === "below_last_year" ? "text-negative" : ""}`}
                        >
                          {day.diffPct == null ? "比較なし" : `${day.diffPct > 0 ? "+" : ""}${day.diffPct}%`}
                        </td>
                        <td className="py-1.5">{day.events.join("、") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
