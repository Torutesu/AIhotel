"use client"

// ダッシュボードタブ（U-15 で各セクションを components/dashboard/* へ分割したコンテナ）
//
// 実データ: GET /dashboard/kpi・/dashboard/alerts・/dashboard/ai-summary・
//           /dashboard/kpi/comparison・/hotels
// サンプル表示: 在庫表（PMS連携・残室推移の記録が未実装）

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorCard } from "@/components/error-state"
import { LabeledMonthPicker } from "@/components/month-picker"
import { usePeriod } from "@/components/app-state-provider"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { AlertsCard } from "@/components/dashboard/alerts-card"
import { AiSummaryCard } from "@/components/dashboard/ai-summary-card"
import { TrendChartCard } from "@/components/dashboard/trend-chart-card"
import { KpiComparisonSection } from "@/components/dashboard/kpi-comparison-section"
import { KpiProgressSection, ALL_KPI_KEYS } from "@/components/dashboard/kpi-progress-section"
import { InventoryTableCard } from "@/components/dashboard/inventory-table-card"
import { SetupChecklistCard } from "@/components/onboarding/setup-checklist-card"
import { api, ApiClientError, type AiSummary, type AlertItem, type DashboardKpi } from "@/lib/api"
import type { AlertLinkTarget } from "@/lib/alert-link"

interface DashboardTabProps {
  /** アラートからの画面遷移（F-4: resolveAlertLink で解決済みの遷移先を渡す） */
  onAlertNavigate?: (target: AlertLinkTarget) => void
}

/**
 * ダッシュボードに表示するアラートの最小レベル（F-DASH-05）。
 * 重要度は1〜5の5段階で管理し、ダッシュボードにはLevel 5・4のみを表示する。
 * Level 3以下は各分析画面側で確認する運用。
 */
const DASHBOARD_MIN_ALERT_LEVEL = 4

const NO_ALERTS: AlertItem[] = []

/** ダッシュボードの取得結果。どのホテルのデータかを持たせ、後から届いたアラートの混入を防ぐ */
interface DashboardData {
  hotelId: string
  kpi: DashboardKpi
  alerts: AlertItem[]
  aiSummary: AiSummary | null
}

/** 設定タブでの保存を同じ画面のダッシュボードへ即時反映するためのイベント名（#51-2） */
const PREFERENCES_UPDATED_EVENT = "preferencesUpdated"

export function DashboardTab({ onAlertNavigate }: DashboardTabProps) {
  const { hotelId, hotel } = useAuth()
  // 対象年月は全タブ共有（URL の ?year=&month= と同期 — U-8）
  const { year, month, periodMonth, setPeriodMonth } = usePeriod()

  // 伸び率の高いサイトの表示/非表示（設定タブから制御）
  const [showTopSitesSection, setShowTopSitesSection] = useState(false)
  // 設定タブで選択されたKPI表示項目（利用者・施設ごと。未保存なら全項目）
  const [visibleKpiKeys, setVisibleKpiKeys] = useState<string[]>([...ALL_KPI_KEYS])


  // 表示設定はサーバ保存（#51-2）。端末やブラウザを変えても同じ表示になる。
  // 取得に失敗しても画面は既定値で表示する（表示設定のためにダッシュボード全体を
  // エラーにはしない）。
  useEffect(() => {
    if (!hotelId) return
    let cancelled = false

    const loadPreferences = async () => {
      try {
        const { dashboard } = await api.getPreferences(hotelId)
        if (cancelled) return
        setShowTopSitesSection(dashboard.showTopSitesSection)
        const valid = dashboard.kpiItems.filter((k) =>
          ALL_KPI_KEYS.includes(k as (typeof ALL_KPI_KEYS)[number]),
        )
        setVisibleKpiKeys(valid.length > 0 ? valid : [...ALL_KPI_KEYS])
      } catch {
        if (cancelled) return
        setShowTopSitesSection(false)
        setVisibleKpiKeys([...ALL_KPI_KEYS])
      }
    }

    loadPreferences()
    window.addEventListener(PREFERENCES_UPDATED_EVENT, loadPreferences)
    return () => {
      cancelled = true
      window.removeEventListener(PREFERENCES_UPDATED_EVENT, loadPreferences)
    }
  }, [hotelId])

  // ホテル・年月を切り替えた直後に前の条件のレスポンスが遅れて返っても使わない（#91）
  const {
    data: dashboard,
    loading,
    error,
    reload: loadData,
    setData: setDashboard,
  } = useApiQuery<DashboardData>(
    hotelId
      ? async () => {
          const [kpi, alerts, aiSummary] = await Promise.all([
            api.dashboardKpi(hotelId, year, month),
            // ダッシュボードはLevel 5・4のみ表示（F-DASH-05）。Level 3以下は各分析画面で確認する
            api.alerts(hotelId, DASHBOARD_MIN_ALERT_LEVEL),
            api.aiSummary(hotelId),
          ])
          return { hotelId, kpi, alerts, aiSummary }
        }
      : null,
    [hotelId, year, month],
  )
  const kpi = dashboard?.kpi ?? null
  const alerts = dashboard?.alerts ?? NO_ALERTS
  const aiSummary = dashboard?.aiSummary ?? null
  // 客室数は認証コンテキストが持つ選択中のホテルから取る（一覧 API を取り直さない）
  const totalRooms = hotel?.totalRooms ?? null

  /** アラートの状態変更後にアラートだけ取り直す（X-4。画面全体の再取得は不要） */
  const reloadAlerts = useCallback(async () => {
    if (!hotelId) return
    try {
      const next = await api.alerts(hotelId, DASHBOARD_MIN_ALERT_LEVEL)
      // 取り直している間にホテルが切り替わっていたら捨てる
      setDashboard((prev) => (prev && prev.hotelId === hotelId ? { ...prev, alerts: next } : prev))
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "アラートの再取得に失敗しました",
      )
    }
  }, [hotelId, setDashboard])

  if (!hotelId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">ホテル情報を読み込んでいます...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorCard message={error} onRetry={loadData} />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {/* 初期設定の必須項目が揃うまで出す（#13） */}
      <SetupChecklistCard />
      <div className="space-y-4">
        {/* 対象年月選択（全タブ共有・URL同期） */}
        <div className="flex flex-wrap items-center gap-3">
          <LabeledMonthPicker
            id="dashboard-period"
            label="対象年月"
            value={periodMonth}
            onChange={setPeriodMonth}
          />
          {totalRooms != null && (
            <div className="ml-auto flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5">
              <p className="text-xs text-muted-foreground">客室数</p>
              <div className="text-lg font-bold">
                {totalRooms.toLocaleString()}
                <span className="ml-0.5 text-sm font-semibold">室</span>
              </div>
            </div>
          )}
        </div>

        <AlertsCard
          alerts={alerts}
          loading={loading}
          onAlertNavigate={onAlertNavigate}
          onAlertUpdated={() => void reloadAlerts()}
        />

        <AiSummaryCard summary={aiSummary} loading={loading} />

        <TrendChartCard kpi={kpi} loading={loading} year={year} month={month} />

        {/* 月初比較・日付比較（U-5 — GET /dashboard/kpi/comparison） */}
        <KpiComparisonSection year={year} month={month} summary={kpi?.summary ?? null} />

        {/* 伸び率の高いサイト上位3件（設定で有効化された場合のみ・対応APIなし） */}
        {showTopSitesSection && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base font-medium">伸び率の高いサイト上位3件</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">この機能は今後提供予定です。</p>
            </CardContent>
          </Card>
        )}

        <KpiProgressSection
          hotelId={hotelId}
          kpi={kpi}
          loading={loading}
          year={year}
          month={month}
          visibleKpiKeys={visibleKpiKeys}
        />

        <InventoryTableCard totalRooms={totalRooms} />
      </div>
    </div>
  )
}
