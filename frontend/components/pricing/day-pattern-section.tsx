"use client"

// 日のAI分析: 似た日の着地とピックアップ型（D-13 — GET /pricing/day-insight の pattern）。
// 背景（区分・曜日・季節・旅行シーズン・連休・イベント・天気）と、ここまでの入り方が近い過去の日の
// 「今から当日まで」のピックアップを今の予約に足した着地と、マイルストーン別のピックアップで分けた型を出す。
// 先の日だけ（材料が足りなければ pattern は null で、このセクションは出さない）。

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DAY_NAMES, parseDateStr } from "@/lib/date"
import { formatPercent as pct, formatRooms, formatYen as yen } from "@/lib/format"
import type { DayInsight } from "@/lib/api"

type DayPattern = NonNullable<DayInsight["pattern"]>

const shortDate = (date: string) => {
  const d = parseDateStr(date)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${DAY_NAMES[d.getDay()]}）`
}

const SHAPE_DESCRIPTIONS: Record<NonNullable<DayPattern["paceCluster"]>["shape"], string> = {
  先行型: "早い時期に予約が多く入る型",
  標準型: "期間を通じて平均的に入る型",
  直前型: "直前に予約が多く入る型",
}

/** 近傍の着地のばらつき（稼働率の標準偏差）を言葉にする */
export function spreadLabel(spread: number): string {
  if (spread <= 0.05) return "ばらつきが小さく、見立ては安定しています"
  if (spread <= 0.12) return "ばらつきは中程度です"
  return "ばらつきが大きいため、予測に混ぜる割合を弱めています"
}

export function DayPatternSection({ pattern }: { pattern: DayPattern }) {
  const cluster = pattern.paceCluster
  const maxPickup = cluster ? Math.max(0.0001, ...cluster.terms.map((t) => t.pickup)) : 1
  return (
    <Card data-testid="day-pattern">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">似た日の着地</CardTitle>
        <p className="text-xs text-muted-foreground">
          背景（曜日・季節・連休・イベント・天気）と、ここまでの予約の入り方が近い過去の{pattern.neighbors}日の「今から当日まで」の伸びを、今の予約に足した着地です。
          宿泊日が近いほど予測稼働率に強く混ぜます。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border px-3 py-2">
            <dt className="text-xs text-muted-foreground">予測稼働</dt>
            <dd className="text-lg font-semibold tabular-nums">{pct(pattern.predictedOccupancy)}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-xs text-muted-foreground">予測ADR</dt>
            <dd className="text-lg font-semibold tabular-nums">{yen(pattern.predictedAdr)}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-xs text-muted-foreground">今から入る見込み</dt>
            <dd className="text-lg font-semibold tabular-nums">{pattern.pickupRooms == null ? "-" : formatRooms(Math.round(pattern.pickupRooms))}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-xs text-muted-foreground">着地のばらつき</dt>
            <dd className="text-lg font-semibold tabular-nums">±{pct(pattern.spread)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{spreadLabel(pattern.spread)}。</p>

        {cluster ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">ピックアップ型</span>
              <Badge variant="outline">{cluster.id}</Badge>
              <Badge variant="secondary">{cluster.shape}</Badge>
              <span className="text-xs text-muted-foreground">
                {SHAPE_DESCRIPTIONS[cluster.shape]}・過去{cluster.days}日・平均の着地 {pct(cluster.finalOccupancy)}
                （ホテル全体の型は{pattern.paceClusterCount}つ）
              </span>
            </div>
            <table className="w-full text-xs" aria-label="マイルストーン別のピックアップ">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-2 py-1 text-left font-normal">区間</th>
                  <th className="px-2 py-1 text-left font-normal">ピックアップ（客室数に対する割合）</th>
                </tr>
              </thead>
              <tbody>
                {cluster.terms.map((t) => (
                  <tr key={t.label} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-2 py-1">{t.label}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div className="h-full rounded-full bg-[color:var(--chart-1)]" style={{ width: `${Math.max(0, (t.pickup / maxPickup) * 100)}%` }} />
                        </div>
                        <span className="w-12 text-right tabular-nums">{pct(t.pickup)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">予約の記録が足りないため、この日のピックアップ型はまだ決まっていません。</p>
        )}

        {pattern.similarDates.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">似た日（着地の材料にした過去の日）</p>
            <ul className="flex flex-wrap gap-1.5">
              {pattern.similarDates.map((d) => (
                <li key={d}>
                  <Badge variant="outline" className="text-[11px] font-normal tabular-nums">
                    {shortDate(d)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
