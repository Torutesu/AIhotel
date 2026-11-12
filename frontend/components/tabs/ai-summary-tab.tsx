"use client"

// 外部需要動向（メニュー名は 2026-10 に「AIまとめ」から変更）。
// 月別需要指数・外部要因の取得状況・要因カード（気候・インバウンド・アクセス）・週別の見通し・今後の注意事項は実データ
// （GET /external-signals/demand-index・/status・/factors — D-13）。AI総合予測コメントは Claude API による文章の生成が未実装のためサンプル。
// イベントと周辺の新規ホテルは登録データ（GET /events・GET /new-hotels）を表示し、個別登録と規定フォーム（CSV）の取り込みができる。
// 要因のカードをクリックすると一覧が開き、CSV に書き出せる。

import { useState, type ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Globe, ExternalLink, Sun, Plane, Calendar, Building2, Sparkles, type LucideIcon } from "lucide-react"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { FactorListDialog } from "@/components/external-demand/factor-list-dialog"
import { FactorCategoryCard } from "@/components/external-demand/factor-category-card"
import { WeeklyOutlookSection } from "@/components/external-demand/weekly-outlook-section"
import { UpcomingCautionsCard } from "@/components/external-demand/upcoming-cautions-card"
import { ErrorState } from "@/components/error-state"
import { EventsDialog, upcomingEvents } from "@/components/external-demand/events-dialog"
import { NewHotelsDialog } from "@/components/external-demand/new-hotels-dialog"
import { DemandIndexSection } from "@/components/external-demand/demand-index-section"
import { ExternalSignalsStatusCard } from "@/components/external-demand/external-signals-status-card"
import type { ExternalFactorRow } from "@/components/external-demand/factors"
import { formatEventRange, impactLabel } from "@/components/pricing/pricing-constants"
import { api, type ExternalFactors, type NewHotelOpening } from "@/lib/api"
import { toDateStr } from "@/lib/date"
import type { Event as HotelEvent } from "@shared/types"

/** 表示期間（例: 2026年10月〜2027年3月） */
function upcomingPeriodLabel(): string {
  const from = new Date()
  from.setDate(1)
  from.setMonth(from.getMonth() + 1)
  const to = new Date(from)
  to.setMonth(to.getMonth() + 5)
  return `${from.getFullYear()}年${from.getMonth() + 1}月〜${to.getFullYear()}年${to.getMonth() + 1}月`
}

// 要因のカード。気候・インバウンド・アクセスは GET /external-signals/factors、イベント・新規ホテルは登録データ
const CATEGORIES: Array<{ key: string; name: string; icon: LucideIcon }> = [
  { key: "climate", name: "気候要因", icon: Sun },
  { key: "inbound", name: "インバウンド動向", icon: Plane },
  { key: "events", name: "イベント", icon: Calendar },
  { key: "access", name: "アクセス", icon: ExternalLink },
  { key: "hotels", name: "新規ホテル", icon: Building2 },
]
const SIGNAL_CATEGORIES = new Set(["climate", "inbound", "access"])

/** 登録データの要約（イベント・新規ホテルのカードの上部） */
function RegisteredSummary({
  title,
  loading,
  error,
  items,
  empty,
}: {
  title: string
  loading: boolean
  error: string | null
  items: Array<{ key: string; label: string; detail: string }>
  empty: string
}) {
  return (
    <div className="mb-3 space-y-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{title}</span>
        <Badge variant="outline" className="text-[10px]">登録データ</Badge>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">読み込み中…</p>
      ) : error ? (
        <p className="text-xs text-negative">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium">{item.label}</span>
              <span className="flex-shrink-0 tabular-nums text-muted-foreground">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AISummaryTab() {
  const { hotelId } = useAuth()
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const eventsQuery = useApiQuery<HotelEvent[]>(hotelId ? () => api.events(hotelId) : null, [hotelId], "イベントの取得に失敗しました")
  const hotelsQuery = useApiQuery<NewHotelOpening[]>(hotelId ? () => api.newHotels(hotelId) : null, [hotelId], "新規ホテルの取得に失敗しました")
  const factorsQuery = useApiQuery<ExternalFactors>(hotelId ? () => api.externalFactors(hotelId) : null, [hotelId], "外部要因の取得に失敗しました")
  const signalFactors = (key: string): ExternalFactorRow[] =>
    SIGNAL_CATEGORIES.has(key) ? (factorsQuery.data?.categories[key as "climate" | "inbound" | "access"] ?? []) : []
  const factorStatus: ReactNode = factorsQuery.loading ? (
    <p className="mb-3 text-xs text-muted-foreground">読み込み中…</p>
  ) : factorsQuery.error ? (
    <ErrorState message={factorsQuery.error} onRetry={factorsQuery.reload} className="mb-3" />
  ) : null

  const upcoming = upcomingEvents(eventsQuery.data ?? [])
  const today = toDateStr(new Date())
  const upcomingHotels = (hotelsQuery.data ?? []).filter((h) => h.openingDate.slice(0, 10) >= today)
  const registered: Record<string, ReactNode> = {
    events: (
      <RegisteredSummary
        title={`今後のイベント ${upcoming.length}件`}
        loading={eventsQuery.loading}
        error={eventsQuery.error}
        empty="登録されたイベントはありません。クリックして登録・取り込みできます。"
        items={upcoming.slice(0, 3).map((e) => ({
          key: e.id,
          label: e.name,
          detail: `${formatEventRange(e.startDate, e.endDate)}${e.expectedImpact ? `・${impactLabel(e.expectedImpact).replace("影響度:", "影響")}` : ""}`,
        }))}
      />
    ),
    hotels: (
      <RegisteredSummary
        title={`開業予定 ${upcomingHotels.length}軒・計 ${upcomingHotels.reduce((sum, h) => sum + (h.rooms ?? 0), 0).toLocaleString()}室`}
        loading={hotelsQuery.loading}
        error={hotelsQuery.error}
        empty="登録された新規ホテルはありません。クリックして登録・取り込みできます。"
        items={upcomingHotels.slice(0, 3).map((h) => ({
          key: h.id,
          label: h.name,
          detail: `${h.openingDate.slice(5, 10).replace("-", "/")}開業${h.rooms != null ? `・${h.rooms}室` : ""}`,
        }))}
      />
    ),
  }
  const openedCategory = CATEGORIES.find((c) => c.key === openCategory && SIGNAL_CATEGORIES.has(c.key)) ?? null

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe className="w-6 h-6" />
          外部需要動向
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          外部要因に基づく先6ヶ月（{upcomingPeriodLabel()}）のマーケット動向予測
        </p>
      </div>

      <SampleDataNotice detail="AI総合予測コメントは Claude API による文章の生成が未実装のためサンプルです。そのほかの数値・要因は実データ（要因は気象庁の予報と、外部要因エージェントが集めた市場の動き）です。" />

      {/* AI総合コメント */}
      <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI総合予測コメント
            <SampleDataNotice compact />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm leading-relaxed">
            <p>
              <strong>【先6ヶ月の総合見通し】</strong><br />
              2026年2月〜7月の期間は、<span className="brand-highlight">3月下旬〜5月上旬が最大の需要期</span>となる見込みです。
              中国春節（2月上旬）のインバウンド需要に始まり、桜シーズン・ゴールデンウィークと続く高需要期間では、
              価格戦略の最適化が収益最大化の鍵となります。
            </p>
            <p>
              <strong>【注意事項】</strong><br />
              <span className="text-warning">6月の梅雨シーズン</span>は需要が大幅に落ち込む予測のため、
              早期の価格調整とプロモーション施策の準備を推奨します。
              また、<span className="text-warning">4月に周辺で2軒の新規ホテルが開業予定</span>のため、
              競合動向の監視を強化してください。
            </p>
            <p>
              <strong>【推奨アクション】</strong><br />
              ・桜シーズン（3月下旬〜4月上旬）：早期予約促進キャンペーンの実施<br />
              ・GW（4/29〜5/5）：連泊割引プランの準備<br />
              ・梅雨期（6月）：平日限定プランや地元向けプロモーションの検討
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 月別需要指数（実データ — D-13）と外部要因の取得状況 */}
      <DemandIndexSection />
      <ExternalSignalsStatusCard />

      {/* 週別の見通し（実データ — D-13） */}
      <WeeklyOutlookSection data={factorsQuery.data} loading={factorsQuery.loading} error={factorsQuery.error} onRetry={factorsQuery.reload} />

      {/* 外部要因カテゴリ別詳細（時間軸b: 要因による期間）。カードをクリックすると一覧・CSV出力（2026-10） */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CATEGORIES.map((category) => (
          <FactorCategoryCard
            key={category.key}
            name={category.name}
            icon={category.icon}
            factors={signalFactors(category.key)}
            linkLabel={SIGNAL_CATEGORIES.has(category.key) ? "一覧・CSV出力" : "一覧・登録・CSV"}
            onOpen={() => setOpenCategory(category.key)}
            top={SIGNAL_CATEGORIES.has(category.key) ? factorStatus : registered[category.key]}
            emptyText={
              SIGNAL_CATEGORIES.has(category.key) && !factorsQuery.loading && !factorsQuery.error
                ? "まだ集めた動きがありません。外部要因エージェントがホテルごとに週1回集めます。"
                : undefined
            }
          />
        ))}
      </div>

      <EventsDialog
        open={openCategory === "events"}
        onOpenChange={(open) => !open && setOpenCategory(null)}
        events={eventsQuery.data}
        loading={eventsQuery.loading}
        error={eventsQuery.error}
        onReload={eventsQuery.reload}
      />
      <NewHotelsDialog
        open={openCategory === "hotels"}
        onOpenChange={(open) => !open && setOpenCategory(null)}
        hotels={hotelsQuery.data}
        loading={hotelsQuery.loading}
        error={hotelsQuery.error}
        onReload={hotelsQuery.reload}
      />
      <FactorListDialog
        open={openedCategory != null}
        onOpenChange={(open) => !open && setOpenCategory(null)}
        category={openedCategory?.name ?? ""}
        factors={openedCategory ? signalFactors(openedCategory.key) : []}
        attribution={factorsQuery.data?.weatherAttribution}
      />

      {/* 今後の注意事項（実データ — D-13） */}
      <UpcomingCautionsCard factors={factorsQuery.data} events={upcoming} hotels={hotelsQuery.data ?? []} today={today} />
    </div>
  )
}
