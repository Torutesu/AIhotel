"use client"

// 在庫表（日別・タイプ別残室推移 — U-15 で dashboard-tab.tsx から分割）
// PMS連携と残室推移の記録が未実装のため、数値はサンプル表示。

import { Fragment, useMemo, useState } from "react"
import { format } from "date-fns"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { useWeekend } from "@/hooks/use-weekend"
import { DAY_NAMES } from "@/lib/date"
import { createSeededRandom } from "@/lib/format"

// 在庫表（日別・タイプ別残室推移）用のサンプル定義。
// PMSでは過去時点の残室を確認できないため、日々の予約情報から残室推移を記録・表示する想定
const INVENTORY_ROOM_TYPES = [
  { key: "standard", label: "スタンダード", share: 0.6 },
  { key: "deluxe", label: "デラックス", share: 0.3 },
  { key: "suite", label: "スイート", share: 0.1 },
]

const SNAPSHOT_OPTIONS = [
  { value: "1", label: "前日時点" },
  { value: "7", label: "1週間前時点" },
  { value: "30", label: "1か月前時点" },
]

interface InventoryTableCardProps {
  totalRooms: number | null
}

export function InventoryTableCard({ totalRooms }: InventoryTableCardProps) {
  const { weekendDays, isWeekendDow } = useWeekend()
  // 在庫表の比較時点（残室推移の記録データと比較する想定。対応APIがないためサンプル表示）
  const [snapshotPeriod, setSnapshotPeriod] = useState("7")

  const inventoryRows = useMemo(() => {
    const rooms = totalRooms ?? 300
    const periodDays = Number(snapshotPeriod)
    const base = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
      const dow = date.getDay()
      const weekend = weekendDays.includes(dow)
      const rng = createSeededRandom(date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate())
      const types = INVENTORY_ROOM_TYPES.map((t) => {
        const capacity = Math.round(rooms * t.share)
        const occ = Math.min(0.98, Math.max(0.2, (weekend ? 0.88 : 0.66) - i * 0.015 + (rng() - 0.5) * 0.1))
        const remaining = Math.max(0, Math.round(capacity * (1 - occ)))
        // 比較時点の残室（過去ほど残室が多い＝その後の予約進捗ぶん）
        const pace = capacity * (0.005 + rng() * 0.02)
        const snapshotRemaining = Math.min(capacity, remaining + Math.round(pace * periodDays))
        return { key: t.key, label: t.label, capacity, remaining, diff: remaining - snapshotRemaining }
      })
      const totalRemaining = types.reduce((a, t) => a + t.remaining, 0)
      const totalDiff = types.reduce((a, t) => a + t.diff, 0)
      return { date, dow, types, totalRemaining, totalDiff }
    })
  }, [totalRooms, snapshotPeriod, weekendDays])

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base font-medium">在庫表（日別・タイプ別残室推移）</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              日々の予約情報から残室数を記録し、選択した時点との推移を表示します（PMSでは過去時点の残室を確認できないため本システムで記録）
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="inventory-snapshot" className="text-xs whitespace-nowrap">
              比較時点
            </Label>
            <Select value={snapshotPeriod} onValueChange={setSnapshotPeriod}>
              <SelectTrigger id="inventory-snapshot" className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SNAPSHOT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2 space-y-2">
        <SampleDataNotice detail="PMS連携と残室推移の記録が未実装のため、以下の残室数はサンプルです。" />
        <div className="overflow-x-auto overflow-y-auto max-h-[520px]">
          <table className="table-sticky-head w-full text-xs border-collapse">
            <thead>
              <tr className="border-b bg-muted/30">
                <th rowSpan={2} className="text-center py-1.5 px-2 font-medium border-r">日付</th>
                <th rowSpan={2} className="text-center py-1.5 px-2 font-medium border-r">曜日</th>
                {INVENTORY_ROOM_TYPES.map((t) => (
                  <th key={t.key} colSpan={2} className="text-center py-1.5 px-2 font-medium border-r">
                    {t.label}
                  </th>
                ))}
                <th colSpan={2} className="text-center py-1.5 px-2 font-medium">合計</th>
              </tr>
              <tr className="border-b bg-muted/30">
                {INVENTORY_ROOM_TYPES.map((t) => (
                  <Fragment key={t.key}>
                    <th className="text-center py-1 px-2 font-normal text-muted-foreground border-r border-dashed">残室</th>
                    <th className="text-center py-1 px-2 font-normal text-muted-foreground border-r">推移</th>
                  </Fragment>
                ))}
                <th className="text-center py-1 px-2 font-normal text-muted-foreground border-r border-dashed">残室</th>
                <th className="text-center py-1 px-2 font-normal text-muted-foreground">推移</th>
              </tr>
            </thead>
            <tbody>
              {inventoryRows.map((row) => {
                const dayName = DAY_NAMES[row.dow]
                const isWeekend = isWeekendDow(row.dow)
                return (
                  <tr key={row.date.toISOString()} className={`border-b hover:bg-muted/20 ${isWeekend ? "bg-primary/5" : ""}`}>
                    <td className="text-center py-1.5 px-2 font-medium border-r">{format(row.date, "M/d")}</td>
                    <td className={`text-center py-1.5 px-2 border-r ${isWeekend ? "text-primary font-medium" : ""}`}>
                      {dayName}
                    </td>
                    {row.types.map((t) => (
                      <Fragment key={t.key}>
                        <td className="text-right py-1.5 px-2 border-r border-dashed">
                          {t.remaining}
                          <span className="text-[9px] text-muted-foreground">/{t.capacity}</span>
                        </td>
                        <td className={`text-right py-1.5 px-2 border-r ${t.diff < 0 ? "text-[color:var(--positive)]" : t.diff > 0 ? "text-[color:var(--negative)]" : "text-muted-foreground"}`}>
                          {t.diff === 0 ? "±0" : t.diff > 0 ? `+${t.diff}` : t.diff}
                        </td>
                      </Fragment>
                    ))}
                    <td className="text-right py-1.5 px-2 font-semibold border-r border-dashed">{row.totalRemaining}</td>
                    <td className={`text-right py-1.5 px-2 font-semibold ${row.totalDiff < 0 ? "text-[color:var(--positive)]" : row.totalDiff > 0 ? "text-[color:var(--negative)]" : "text-muted-foreground"}`}>
                      {row.totalDiff === 0 ? "±0" : row.totalDiff > 0 ? `+${row.totalDiff}` : row.totalDiff}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          ※ 推移は比較時点からの残室数の増減です（マイナス＝予約が進んで残室が減少）。表示は今後14日分です
        </p>
      </CardContent>
    </Card>
  )
}
