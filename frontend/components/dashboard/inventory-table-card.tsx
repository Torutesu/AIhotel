"use client"

// 在庫表（日別・タイプ別残室推移 — U-15 で dashboard-tab.tsx から分割。2026-10 の画面修正 DB02 で作り直し）。
// 選んだ日から14日を列に、部屋タイプ別の残室と比較時点からの増減、故障部屋、個人・団体の予約室数・団体のwash想定、
// 残室想定（販売可能室数 = 残室＋wash想定）を並べる（PDF a02・xlsx DB02）。表示する日は選んで移動できる。
// 団体の取り扱いが多い施設向けに、団体をセグメント別（一般団体・募集・修学旅行・スポーツ団体）にも表示できる。
// PMS連携と残室推移の記録が未実装のため、数値はサンプル表示。

import { Fragment, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { useWeekend } from "@/hooks/use-weekend"
import { DAY_NAMES, parseDateStr, toDateStr } from "@/lib/date"
import { createSeededRandom } from "@/lib/format"
import { cn } from "@/lib/utils"

/** 部屋タイプ（サンプル。客室数の比で割り振る） */
const INVENTORY_ROOM_TYPES = [
  { key: "SD1", share: 0.6 },
  { key: "DX1", share: 0.3 },
  { key: "DX2", share: 0.1 },
]

/** 団体のセグメント（サンプル） */
export const GROUP_SEGMENTS = [
  { key: "general", label: "一般団体室数" },
  { key: "recruit", label: "募集室数" },
  { key: "school", label: "修学旅行室数" },
  { key: "sports", label: "スポーツ団体", note: "敗退CXL団体" },
]

const SNAPSHOT_OPTIONS = [
  { value: "1", label: "前日時点" },
  { value: "7", label: "1週間前時点" },
  { value: "30", label: "1か月前時点" },
]

export const INVENTORY_DAYS = 14

interface GroupFigures {
  booked: number
  wash: number
  expected: number
}

export interface InventoryDay {
  date: Date
  dow: number
  types: Array<{ key: string; capacity: number; remaining: number; diff: number; outOfOrder: number }>
  totalRemaining: number
  totalDiff: number
  /** 故障部屋（販売できない部屋。残室に含めない） */
  totalOutOfOrder: number
  /** 個人の予約室数（予約室数の合計 − 団体の予約室数） */
  individualBooked: number
  group: GroupFigures
  segments: Record<string, GroupFigures>
  /** 残室想定（販売可能室数）= 残室 ＋ wash想定（団体の取消見込みは売り直せる） */
  sellable: number
}

/** サンプルの在庫（日付から決まる。純関数） */
export function buildSampleInventory(totalRooms: number, snapshotDays: number, weekendDays: number[], base = new Date()): InventoryDay[] {
  const capacities = INVENTORY_ROOM_TYPES.map((t) => Math.round(totalRooms * t.share))
  return Array.from({ length: INVENTORY_DAYS }, (_, i) => {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
    const dow = date.getDay()
    const weekend = weekendDays.includes(dow)
    const rng = createSeededRandom(date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate())
    const types = INVENTORY_ROOM_TYPES.map((t, ti) => {
      const capacity = capacities[ti]
      const occ = Math.min(0.97, Math.max(0.25, (weekend ? 0.84 : 0.62) - i * 0.012 + (rng() - 0.5) * 0.1))
      // 故障部屋: 2割ほどの日に1〜2室（販売できないので残室から除く）
      const outOfOrder = rng() > 0.8 ? 1 + Math.floor(rng() * 2) : 0
      const remaining = Math.max(0, Math.round(capacity * (1 - occ)) - outOfOrder)
      // 比較時点の残室（過去ほど残室が多い＝その後の予約の進みぶん）
      const pace = capacity * (0.004 + rng() * 0.012)
      const snapshotRemaining = Math.min(capacity, remaining + Math.round(pace * snapshotDays))
      return { key: t.key, capacity, remaining, diff: remaining - snapshotRemaining, outOfOrder }
    })
    // 団体: 4割ほどの日は無し。あれば客室の3〜12%
    const segments: Record<string, GroupFigures> = {}
    for (const seg of GROUP_SEGMENTS) {
      const has = rng() > (seg.key === "general" ? 0.45 : 0.75)
      const booked = has ? Math.round(totalRooms * (0.01 + rng() * 0.04)) : 0
      // wash（取消見込み）: スポーツ団体は敗退で取り消しが出やすい
      const washRate = seg.key === "sports" ? 0.25 + rng() * 0.2 : rng() * 0.12
      const wash = Math.round(booked * washRate)
      segments[seg.key] = { booked, wash, expected: booked - wash }
    }
    const group = Object.values(segments).reduce(
      (acc, s) => ({ booked: acc.booked + s.booked, wash: acc.wash + s.wash, expected: acc.expected + s.expected }),
      { booked: 0, wash: 0, expected: 0 },
    )
    const totalRemaining = types.reduce((a, t) => a + t.remaining, 0)
    const totalOutOfOrder = types.reduce((a, t) => a + t.outOfOrder, 0)
    const bookedTotal = types.reduce((a, t) => a + t.capacity - t.remaining - t.outOfOrder, 0)
    return {
      date,
      dow,
      types,
      totalRemaining,
      totalDiff: types.reduce((a, t) => a + t.diff, 0),
      totalOutOfOrder,
      individualBooked: Math.max(0, bookedTotal - group.booked),
      group,
      segments,
      sellable: totalRemaining + group.wash,
    }
  })
}

function DiffCell({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <td
      className={cn(
        "border-l px-1.5 py-1 text-right tabular-nums",
        strong && "font-semibold",
        value < 0 ? "text-[color:var(--positive)]" : value > 0 ? "text-[color:var(--negative)]" : "text-muted-foreground",
      )}
    >
      {value === 0 ? "±0" : value > 0 ? `+${value}` : value}
    </td>
  )
}

function NumberCell({ value, strong, muted }: { value: number; strong?: boolean; muted?: boolean }) {
  return (
    <td className={cn("border-l px-1.5 py-1 text-right tabular-nums", strong && "font-semibold", muted && value === 0 && "text-muted-foreground")}>
      {value}
    </td>
  )
}

interface InventoryTableCardProps {
  totalRooms: number | null
}

export function InventoryTableCard({ totalRooms }: InventoryTableCardProps) {
  const { weekendDays, isWeekendDow } = useWeekend()
  const [snapshotPeriod, setSnapshotPeriod] = useState("7")
  const [bySegment, setBySegment] = useState(false)
  // 表示を始める日（"yyyy-MM-dd"）。既定は今日。前後の14日へ移動できる
  const [startDate, setStartDate] = useState(() => toDateStr(new Date()))
  const rooms = totalRooms ?? 200
  const start = parseDateStr(startDate)
  const shift = (days: number) => setStartDate(toDateStr(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days)))

  const days = useMemo(
    () => buildSampleInventory(rooms, Number(snapshotPeriod), weekendDays, parseDateStr(startDate)),
    [rooms, snapshotPeriod, weekendDays, startDate],
  )
  const capacities = days[0]?.types.map((t) => t.capacity) ?? []
  const snapshotLabel = SNAPSHOT_OPTIONS.find((o) => o.value === snapshotPeriod)?.label ?? ""

  const groupRows = (label: string, pick: (d: InventoryDay) => GroupFigures, note?: string, strong?: boolean) => (
    <>
      <tr className="border-b border-dashed">
        <th rowSpan={3} scope="rowgroup" className="whitespace-nowrap border-r px-2 py-1 text-left align-top font-medium">
          {label}
          {note && <span className="block text-[10px] font-normal text-muted-foreground">＜{note}＞</span>}
        </th>
        <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-normal text-muted-foreground">予約室数</th>
        {days.map((d) => (
          <NumberCell key={d.date.toISOString()} value={pick(d).booked} muted strong={strong} />
        ))}
      </tr>
      <tr className="border-b border-dashed">
        <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-normal text-muted-foreground">wash想定</th>
        {days.map((d) => (
          <NumberCell key={d.date.toISOString()} value={pick(d).wash} muted strong={strong} />
        ))}
      </tr>
      <tr className="border-b">
        <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-normal text-muted-foreground">想定室数</th>
        {days.map((d) => (
          <NumberCell key={d.date.toISOString()} value={pick(d).expected} muted strong />
        ))}
      </tr>
    </>
  )

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium">在庫表（{INVENTORY_DAYS}日間・タイプ別残室）</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              日々の予約情報から残室数を記録し、比較時点からの増減を表示します（PMSでは過去時点の残室を確認できないため本システムで記録）。
              団体は予約室数から取消見込み（wash）を引いた想定室数で見て、wash分は販売可能室数に戻します。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <Label htmlFor="inventory-start" className="whitespace-nowrap text-xs">
                対象日
              </Label>
              <Button variant="outline" size="icon" className="h-8 w-8" aria-label="前の14日" onClick={() => shift(-INVENTORY_DAYS)}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Input
                id="inventory-start"
                type="date"
                className="h-8 w-36 text-xs"
                value={startDate}
                onChange={(e) => e.target.value && setStartDate(e.target.value)}
              />
              <Button variant="outline" size="icon" className="h-8 w-8" aria-label="次の14日" onClick={() => shift(INVENTORY_DAYS)}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setStartDate(toDateStr(new Date()))}>
                今日
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch id="inventory-segment" checked={bySegment} onCheckedChange={setBySegment} />
              <Label htmlFor="inventory-segment" className="whitespace-nowrap text-xs">
                団体をセグメント別に表示
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="inventory-snapshot" className="whitespace-nowrap text-xs">
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
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        <SampleDataNotice detail="PMS連携と残室推移の記録が未実装のため、以下の残室数・団体の室数はサンプルです。" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="whitespace-nowrap border-r px-2 py-1.5 text-left font-medium">タイプ名／室数</th>
                <th className="px-2 py-1.5 text-left font-medium">日付</th>
                {days.map((d) => (
                  <th key={d.date.toISOString()} className="border-l px-1.5 py-1.5 text-center font-medium tabular-nums">
                    {d.date.getMonth() + 1}/{d.date.getDate()}
                  </th>
                ))}
              </tr>
              <tr className="border-b bg-muted/30">
                <th className="border-r" />
                <th className="px-2 py-1 text-left font-normal text-muted-foreground">曜日</th>
                {days.map((d) => (
                  <th
                    key={d.date.toISOString()}
                    className={cn("border-l px-1.5 py-1 text-center font-normal", isWeekendDow(d.dow) ? "font-medium text-primary" : "text-muted-foreground")}
                  >
                    {DAY_NAMES[d.dow]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INVENTORY_ROOM_TYPES.map((t, ti) => (
                <Fragment key={t.key}>
                  <tr className="border-b border-dashed">
                    <th rowSpan={2} scope="rowgroup" className="whitespace-nowrap border-r px-2 py-1 text-left align-top font-medium">
                      {t.key}
                      <span className="ml-1 font-normal text-muted-foreground">{capacities[ti]}室</span>
                    </th>
                    <th scope="row" className="px-2 py-1 text-left font-normal text-muted-foreground">残室</th>
                    {days.map((d) => (
                      <NumberCell key={d.date.toISOString()} value={d.types[ti].remaining} />
                    ))}
                  </tr>
                  <tr className="border-b">
                    <th scope="row" className="px-2 py-1 text-left font-normal text-muted-foreground">増減</th>
                    {days.map((d) => (
                      <DiffCell key={d.date.toISOString()} value={d.types[ti].diff} />
                    ))}
                  </tr>
                </Fragment>
              ))}
              <tr className="border-b">
                <th scope="row" className="whitespace-nowrap border-r px-2 py-1 text-left font-medium">故障部屋</th>
                <th scope="row" className="px-2 py-1 text-left font-normal text-muted-foreground">室数</th>
                {days.map((d) => (
                  <NumberCell key={d.date.toISOString()} value={d.totalOutOfOrder} muted />
                ))}
              </tr>
              <tr className="border-b border-dashed bg-muted/20">
                <th rowSpan={2} scope="rowgroup" className="whitespace-nowrap border-r px-2 py-1 text-left align-top font-semibold">
                  合計
                  <span className="ml-1 font-normal text-muted-foreground">{capacities.reduce((a, b) => a + b, 0)}室</span>
                </th>
                <th scope="row" className="px-2 py-1 text-left font-normal text-muted-foreground">残室</th>
                {days.map((d) => (
                  <NumberCell key={d.date.toISOString()} value={d.totalRemaining} strong />
                ))}
              </tr>
              <tr className="border-b-2 bg-muted/20">
                <th scope="row" className="px-2 py-1 text-left font-normal text-muted-foreground">増減</th>
                {days.map((d) => (
                  <DiffCell key={d.date.toISOString()} value={d.totalDiff} strong />
                ))}
              </tr>

              <tr>
                <td colSpan={days.length + 2} className="px-2 pb-1 pt-3 text-[11px] font-medium text-muted-foreground">
                  予約の内訳（個人・団体）
                </td>
              </tr>
              <tr className="border-b">
                <th scope="row" className="whitespace-nowrap border-r px-2 py-1 text-left font-medium">個人</th>
                <th scope="row" className="px-2 py-1 text-left font-normal text-muted-foreground">予約室数</th>
                {days.map((d) => (
                  <NumberCell key={d.date.toISOString()} value={d.individualBooked} />
                ))}
              </tr>
              <tr>
                <td colSpan={days.length + 2} className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                  内 団体分{bySegment ? "（セグメント別）" : ""}
                </td>
              </tr>
              {bySegment ? (
                <>
                  {GROUP_SEGMENTS.map((seg) => (
                    <Fragment key={seg.key}>{groupRows(seg.label, (d) => d.segments[seg.key], seg.note)}</Fragment>
                  ))}
                  {groupRows("合計", (d) => d.group, undefined, true)}
                </>
              ) : (
                groupRows("団体予約室数", (d) => d.group)
              )}
              <tr className="border-t-2 bg-primary/5">
                <th colSpan={2} scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                  残室想定（販売可能室数）
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">（残室＋wash想定）</span>
                </th>
                {days.map((d) => (
                  <NumberCell key={d.date.toISOString()} value={d.sellable} strong />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          ※ 増減は{snapshotLabel}からの残室数の増減です（マイナス＝予約が進んで残室が減少）。故障部屋は販売できないため残室に含めません。
          団体の取り扱いが多い施設は「団体をセグメント別に表示」で内訳を確認できます
        </p>
      </CardContent>
    </Card>
  )
}
