"use client"

// 外部需要動向の要因カード（気候・インバウンド・イベント・アクセス・新規ホテル — 2026-10、D-13 で実データに）。
// カードをクリックすると一覧（登録・CSV 出力）が開く。

import type { ReactNode } from "react"
import { List, Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FACTOR_SOURCE_LABELS, type ExternalFactorRow } from "./factors"

export function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-positive" aria-label="上向き" />
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-negative" aria-label="下向き" />
  return <Minus className="h-4 w-4 text-muted-foreground" aria-label="横ばい" />
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "positive") return <Badge className="bg-positive/10 text-positive">追い風</Badge>
  if (status === "warning") return <Badge className="bg-warning/10 text-warning">注意</Badge>
  if (status === "normal") return <Badge variant="secondary">通常</Badge>
  return <Badge variant="outline">-</Badge>
}

interface FactorCategoryCardProps {
  name: string
  icon: LucideIcon
  factors: ExternalFactorRow[]
  /** 右上の案内（例「一覧・CSV出力」） */
  linkLabel: string
  onOpen: () => void
  /** カードの上部（登録データの要約など） */
  top?: ReactNode
  /** 行が無いときの案内。省略すると何も出さない */
  emptyText?: string
}

export function FactorCategoryCard({ name, icon: Icon, factors, linkLabel, onOpen, top, emptyText }: FactorCategoryCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${name}の一覧を開く`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className="cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base font-medium">
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4" aria-hidden />
            {name}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            <List className="h-3.5 w-3.5" aria-hidden />
            {linkLabel}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top}
        {factors.length === 0 ? (
          emptyText ? <p className="text-xs text-muted-foreground">{emptyText}</p> : null
        ) : (
          <div className="space-y-3">
            {factors.map((factor) => (
              <div key={factor.name} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <TrendIcon trend={factor.trend} />
                  <span className="truncate">{factor.name}</span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {factor.source && (
                    <Badge variant="outline" className="text-[10px]">
                      {FACTOR_SOURCE_LABELS[factor.source]}
                    </Badge>
                  )}
                  <StatusBadge status={factor.status} />
                </div>
              </div>
            ))}
            <div className="space-y-3 border-t pt-2">
              {factors.map((factor) => (
                <div key={factor.name} className="rounded-md bg-muted/40 px-2.5 py-2">
                  <p className="text-xs leading-snug text-muted-foreground">
                    <span className="font-medium text-foreground">{factor.name}</span> — {factor.note}
                  </p>
                  {factor.kpis && factor.kpis.length > 0 && (
                    <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2">
                      {factor.kpis.map((kpi) => (
                        <div key={kpi.label} className="flex flex-col gap-0.5 border-l-2 border-primary/25 pl-2">
                          <dt className="text-[10px] tracking-wide text-muted-foreground">{kpi.label}</dt>
                          <dd className="text-sm font-semibold tabular-nums tracking-tight">{kpi.value}</dd>
                          {kpi.hint ? <span className="text-[10px] text-muted-foreground">{kpi.hint}</span> : null}
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
