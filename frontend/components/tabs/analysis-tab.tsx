"use client"

// 分析タブ（U-15 で各セクションを components/analysis/* へ分割したコンテナ）
//
// 分析の切り口が重複しないよう、見る軸ごとに5つへ再編している。
//  - 実績推移 : いつ（日別・曜日別・年間の時系列）
//  - 需要構成 : 誰が・どこから・何を（チャネル/部屋タイプ/セグメント）
//  - 予約動向 : いつ予約が入るか（ブッキングカーブ・予約期間）
//  - 競合比較 : 外部との比較
//  - フリー分析: 自由軸の分析と販促データ管理

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
import { DailyCompetitorSection } from "@/components/analysis/daily-competitor-section"
import { ChannelAnalysisSection } from "@/components/analysis/channel-analysis-section"
import { RoomTypeAnalysisSection } from "@/components/analysis/room-type-analysis-section"
import { BookingPeriodAnalysisSection } from "@/components/analysis/booking-period-analysis-section"
import { SegmentAnalysisSection } from "@/components/analysis/segment-analysis-section"
import { CompetitorAnalysisSection } from "@/components/analysis/competitor-analysis-section"
import { YearlyTrendSection } from "@/components/analysis/yearly-trend-section"
import { FreeAnalysisSection } from "@/components/analysis/free-analysis-section"
import { OtaCampaignSection } from "@/components/analysis/ota-campaign-section"

interface AnalysisTabProps {
  /** 日別テーブルの日付からダイナミックプライシング画面の同じ日へ遷移する */
  onNavigateToPricing?: (date: Date) => void
}

/**
 * 分析タブ（旧「日別分析」＋「各種分析」の統合）。
 * 分析の切り口が重複しないよう、見る軸ごとに5つへ再編している。
 *  - 実績推移 : いつ（日別・曜日別・年間の時系列）
 *  - 需要構成 : 誰が・どこから・何を（チャネル/部屋タイプ/セグメント）
 *  - 予約動向 : いつ予約が入るか（ブッキングカーブ・予約期間）
 *  - 競合比較 : 外部との比較
 *  - フリー分析: 自由軸の分析と販促データ管理
 */
const ANALYSIS_VIEWS = [
  { value: "performance", label: "実績推移", description: "日別・曜日別・年間の時系列で実績を見る" },
  { value: "composition", label: "需要構成", description: "チャネル・部屋タイプ・顧客セグメント別に需要の内訳を見る" },
  { value: "booking", label: "予約動向", description: "宿泊日までのリードタイムで予約の入り方を見る" },
  { value: "competitor", label: "競合比較", description: "競合ホテルとの価格を日別・期間集計で比較する" },
  { value: "free", label: "フリー分析", description: "任意の軸を組み合わせて分析し、販促参画データを管理する" },
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

        {/* 実績推移: 日別 → 曜日別 → 年間の順で粒度を粗くしていく */}
        <TabsContent value="performance" className="space-y-4">
          {/* 対象期間は画面上部のセレクタに一本化する（同じ "YYYY-MM" 形式） */}
          <DailyPerformanceSection
            targetMonth={targetPeriod}
            onTargetMonthChange={setTargetPeriod}
            onNavigateToPricing={onNavigateToPricing}
            onSelectStayDate={(date) => {
              setCurveStayDate(date)
              setAnalysisView("booking")
            }}
          />
          <WeekdayPerformanceSection />
          <YearlyTrendSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
        </TabsContent>

        {/* 需要構成: どこから・何を・誰が */}
        <TabsContent value="composition" className="space-y-4">
          <ChannelAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
          <RoomTypeAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
          <SegmentAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
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
        </TabsContent>

        {/* フリー分析と販促データ管理 */}
        <TabsContent value="free" className="space-y-4">
          <FreeAnalysisSection targetPeriod={targetPeriod} onTargetPeriodChange={setTargetPeriod} />
          <OtaCampaignSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}
