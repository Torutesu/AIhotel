"use client"

// 分析タブ（U-15 で各セクションを components/analysis/* へ分割したコンテナ）
//
// 分析の切り口が重複しないよう、見る軸ごとに6つへ再編している。
//  - 実績推移 : いつ（日別・曜日別・日のタイプ別・年間の時系列）
//  - 需要構成 : 誰が・どこから・何を（チャネル/部屋タイプ/利用人数）
//  - 予約動向 : いつ予約が入るか（ブッキングカーブ・リードタイム）
//  - 競合比較 : 外部との比較（競合価格・口コミ評価点）
//  - OTA販促状況: OTA の販促の参加状況と実績（2026-10 PDF c分析06 でフリー分析から独立）
//  - フリー分析: 自由軸の分析

import { useState } from "react"
import { BarChart3, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SegmentCrossAnalysisSettings } from "@/components/segment-cross-analysis-settings"
import { LabeledMonthPicker } from "@/components/month-picker"
import { useAppState, usePeriod } from "@/components/app-state-provider"
import type { AnalysisView } from "@/lib/alert-link"

import { DailyAiInsightSection } from "@/components/analysis/daily-ai-insight-section"
import { DailyPerformanceSection } from "@/components/analysis/daily-performance-section"
import { BookingCurveSection } from "@/components/analysis/booking-curve-section"
import { WeekdayPerformanceSection } from "@/components/analysis/weekday-performance-section"
import { DayTypePerformanceSection } from "@/components/analysis/day-type-performance-section"
import { DailyCompetitorSection } from "@/components/analysis/daily-competitor-section"
import { CompositionInsightSection } from "@/components/analysis/composition-insight-section"
import { ChannelAnalysisSection } from "@/components/analysis/channel-analysis-section"
import { RoomTypeAnalysisSection } from "@/components/analysis/room-type-analysis-section"
import { GuestCountAnalysisSection } from "@/components/analysis/guest-count-analysis-section"
import { BookingPeriodAnalysisSection } from "@/components/analysis/booking-period-analysis-section"
import { CompetitorAnalysisSection } from "@/components/analysis/competitor-analysis-section"
import { ReviewScoreSection } from "@/components/analysis/review-score-section"
import { YearlyTrendSection } from "@/components/analysis/yearly-trend-section"
import { FreeAnalysisSection } from "@/components/analysis/free-analysis-section"
import { OtaPromotionSection } from "@/components/analysis/ota-promotion-section"

interface AnalysisTabProps {
  /** 日別テーブルの日付からダイナミックプライシング画面の同じ日へ遷移する */
  onNavigateToPricing?: (date: Date) => void
}

/**
 * 分析タブ（旧「日別分析」＋「各種分析」の統合）。並びは 2026-10 PDF c分析06 の順:
 * 実績推移 → 需要構成 → 予約動向 → 競合比較 → OTA販促状況 → フリー分析
 */
const ANALYSIS_VIEWS = [
  { value: "performance", label: "実績推移", description: "日別・曜日別・日のタイプ別・年間の時系列で実績を見る（当月以降は実績＋予約）" },
  { value: "composition", label: "需要構成", description: "チャネル・部屋タイプ・利用人数別に需要の構成比を見る（前年同月比）" },
  { value: "booking", label: "予約動向", description: "宿泊日までのリードタイムで予約・キャンセルの入り方を見る" },
  {
    value: "competitor",
    label: "競合比較",
    description: "競合ホテルとの価格を日別・期間集計で比較し、OTA別の口コミ評価点を確認する",
  },
  { value: "ota", label: "OTA販促状況", description: "OTA の販促の参加状況と実績を一覧で見る（毎週火曜日に更新）" },
  { value: "free", label: "フリー分析", description: "任意の軸を組み合わせて分析する" },
]

export function AnalysisTab({ onNavigateToPricing }: AnalysisTabProps = {}) {
  // 対象年月・分析ビューは全タブ共有（URL の ?year=&month=&view= と同期 — U-8）
  const { periodMonth: targetPeriod, setPeriodMonth: setTargetPeriod } = usePeriod()
  const { analysisView: activeView, setAnalysisView } = useAppState()
  const [viewMode, setViewMode] = useState<"analysis" | "segment-settings">("analysis")

  // 日別テーブルの行クリックで選ばれた宿泊日（予約動向のブッキングカーブと連動する）
  const [curveStayDate, setCurveStayDate] = useState<Date | undefined>(undefined)

  const activeViewMeta = ANALYSIS_VIEWS.find((v) => v.value === activeView)

  // セグメント別クロス分析設定
  if (viewMode === "segment-settings") {
    return (
      <div className="p-4">
        <div className="mb-4 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setViewMode("analysis")} className="gap-2">
            <BarChart3 className="w-4 h-4" />
            分析に戻る
          </Button>
        </div>
        {/* onSave は省略可（保存 API は未接続。B-1 で追加予定） */}
        <SegmentCrossAnalysisSettings />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-balance">分析</h2>
          <p className="text-sm text-muted-foreground mt-1">
            日次の実績から需要構成・予約動向・競合比較までを一画面で確認します
          </p>
        </div>
        <Button onClick={() => setViewMode("segment-settings")} variant="outline" size="sm" className="gap-2">
          <Settings className="w-4 h-4" />
          セグメント別クロス分析設定
        </Button>
      </div>

      {/* アラートの欄は置かない（2026-10 PDF c分析01実績推移1「ここは不要」。アラートはダッシュボードで確認し、対応・解決で外す） */}
      <DailyAiInsightSection />

      <Tabs
        value={activeView}
        onValueChange={(value) => setAnalysisView(value as AnalysisView)}
        className="space-y-4"
      >
        {/* 対象期間と分析軸の切り替え */}
        <Card>
          <CardContent className="px-4 py-3">
            {/* 主: 分析軸の切り替え。従: 対象期間のフィルタ */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="w-full min-w-0 overflow-x-auto lg:w-auto">
                <TabsList className="h-9 inline-flex">
                  {ANALYSIS_VIEWS.map((view) => (
                    <TabsTrigger
                      key={view.value}
                      value={view.value}
                      title={view.description}
                      className="text-sm px-4 py-2"
                    >
                      {view.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <LabeledMonthPicker
                id="analysis-period"
                label="対象期間"
                value={targetPeriod}
                onChange={setTargetPeriod}
              />
            </div>
            {activeViewMeta && (
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                {activeViewMeta.description}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 実績推移: 日別 → 曜日別 → 日のタイプ別 → 年間の順で粒度を粗くしていく */}
        <TabsContent value="performance" className="space-y-4">
          {/* 対象期間は画面上部のセレクタに一本化する（同じ "YYYY-MM" 形式） */}
          <DailyPerformanceSection
            targetMonth={targetPeriod}
            onTargetMonthChange={setTargetPeriod}
            onNavigateToPricing={onNavigateToPricing}
            onSelectStayDate={setCurveStayDate}
            onOpenBookingCurve={() => setAnalysisView("booking")}
          />
          <WeekdayPerformanceSection />
          <DayTypePerformanceSection />
          <YearlyTrendSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
        </TabsContent>

        {/* 需要構成: どこから・何を・誰が（3つを同じ表・グラフで — c分析02） */}
        <TabsContent value="composition" className="space-y-4">
          <CompositionInsightSection />
          <ChannelAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
          <RoomTypeAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
          <GuestCountAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
        </TabsContent>

        {/* 予約動向: 宿泊日までのリードタイム */}
        <TabsContent value="booking" className="space-y-4">
          <BookingCurveSection stayDate={curveStayDate} onStayDateChange={setCurveStayDate} />
          <BookingPeriodAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
        </TabsContent>

        {/* 競合比較: 日別の価格差 → 期間集計 */}
        <TabsContent value="competitor" className="space-y-4">
          <DailyCompetitorSection />
          <CompetitorAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
          {/* 口コミ評価点（GET /analysis/reviews の実データ — X-6） */}
          <ReviewScoreSection />
        </TabsContent>

        {/* OTA販促状況（c分析06） */}
        <TabsContent value="ota" className="space-y-4">
          <OtaPromotionSection />
        </TabsContent>

        {/* フリー分析 */}
        <TabsContent value="free" className="space-y-4">
          <FreeAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
