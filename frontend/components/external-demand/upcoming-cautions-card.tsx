"use client"

// 今後の注意事項（D-13 で実データに）。向かい風の外部要因（市場の動き・天気）、近く開業する周辺の新規ホテル、
// 影響の大きいイベントを並べる。どれも無ければそう書く。

import { AlertTriangle, Building2, CalendarDays, CloudRain } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ExternalFactors, NewHotelOpening } from "@/lib/api"
import { formatEventRange } from "@/components/pricing/pricing-constants"
import type { Event as HotelEvent } from "@shared/types"

/** 近く開業する新規ホテルの範囲（日） */
const HOTEL_HORIZON_DAYS = 180

interface UpcomingCautionsCardProps {
  factors: ExternalFactors | null
  events: HotelEvent[]
  hotels: NewHotelOpening[]
  today: string
}

export function UpcomingCautionsCard({ factors, events, hotels, today }: UpcomingCautionsCardProps) {
  const horizon = new Date(`${today}T00:00:00Z`)
  horizon.setUTCDate(horizon.getUTCDate() + HOTEL_HORIZON_DAYS)
  const horizonStr = horizon.toISOString().slice(0, 10)
  const headwinds = factors ? [...factors.categories.climate, ...factors.categories.inbound, ...factors.categories.access].filter((f) => f.status === "warning") : []
  const openings = hotels.filter((h) => h.openingDate.slice(0, 10) >= today && h.openingDate.slice(0, 10) <= horizonStr)
  const bigEvents = events.filter((e) => e.expectedImpact === "high").slice(0, 3)
  const empty = headwinds.length === 0 && openings.length === 0 && bigEvents.length === 0

  return (
    <Card className="border-warning/30 bg-warning/10" data-testid="upcoming-cautions">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-warning">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          今後の注意事項
        </CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-sm text-muted-foreground">注意が要る外部要因は、今のところ見つかっていません。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {headwinds.map((f) => (
              <li key={`f-${f.name}`} className="flex items-start gap-2">
                <CloudRain className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-medium">{f.name}</span>: {f.note}
                  {f.kpis.find((k) => k.label === "期間") && <span className="text-muted-foreground">（{f.kpis.find((k) => k.label === "期間")!.value}）</span>}
                </span>
              </li>
            ))}
            {openings.length > 0 && (
              <li className="flex items-start gap-2">
                <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-medium">周辺の新規ホテル</span>: {HOTEL_HORIZON_DAYS}日以内に {openings.length}軒
                  {openings.some((h) => h.rooms != null) && `・計 ${openings.reduce((s, h) => s + (h.rooms ?? 0), 0).toLocaleString()}室`}
                  が開業します（{openings.map((h) => `${h.name} ${h.openingDate.slice(5, 10).replace("-", "/")}`).join("、")}）。競合価格の動きに注意してください。
                </span>
              </li>
            )}
            {bigEvents.map((e) => (
              <li key={`e-${e.id}`} className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-medium">{e.name}</span>（{formatEventRange(e.startDate, e.endDate)}）: 影響の大きいイベントです。早めに価格の幅を確かめてください。
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
