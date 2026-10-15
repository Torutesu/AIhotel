"use client"

import { useEffect, useRef, useState } from "react"
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  FileText,
  MessageCircle,
  Settings,
  Brain,
  LogOut,
  Loader2,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  AlertCircle,
} from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DashboardTab } from "@/components/tabs/dashboard-tab"
import { PricingTab } from "@/components/tabs/pricing-tab"
import { AnalysisTab } from "@/components/tabs/analysis-tab"
import { ReportsTab } from "@/components/tabs/reports-tab"
import { SettingsTab } from "@/components/tabs/settings-tab"
import { AISummaryTab } from "@/components/tabs/ai-summary-tab"
import { ChatInterface } from "@/components/chat-interface"
import { DemoModeBanner } from "@/components/demo-mode-banner"
import { TrialBanner } from "@/components/trial-banner"
import { useAuth } from "@/components/auth-provider"
import { useAppState } from "@/components/app-state-provider"
import { LoginForm } from "@/components/login-form"
import { ErrorBoundary } from "@/components/error-boundary"
import { NoHotelState } from "@/components/onboarding/no-hotel-state"
import { ForcePasswordChange } from "@/components/onboarding/force-password-change"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { HotelSwitcher } from "@/components/hotel-switcher"
import type { Tab } from "@shared/types"
import type { AlertLinkTarget } from "@/lib/alert-link"

const tabs = [
  { id: "dashboard" as const, label: "ダッシュボード", icon: LayoutDashboard },
  { id: "pricing" as const, label: "ダイナミックプライシング", icon: TrendingUp },
  { id: "analysis" as const, label: "分析", icon: BarChart3 },
  { id: "reports" as const, label: "レポート", icon: FileText },
  { id: "ai-summary" as const, label: "AIまとめ", icon: Brain },
]

const SIDEBAR_COLLAPSED_KEY = "hrms.sidebarCollapsed"

const APP_NAME = "ホテレベ"

/** タブごとのブラウザタブ表示名（F-8） */
const TAB_TITLES: Record<Tab, string> = {
  dashboard: "ダッシュボード",
  pricing: "ダイナミックプライシング",
  analysis: "分析",
  reports: "レポート",
  "ai-summary": "AIまとめ",
  settings: "設定",
}

export function MainLayout() {
  // タブ・対象年月・分析ビューは URL（?tab=&year=&month=&view=）が唯一の出所（U-8）
  const { tab: activeTab, setTab, navigate, setPeriodMonth } = useAppState()
  const chatButtonRef = useRef<HTMLButtonElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // 分析タブの日付からダイナミックプライシングへ遷移する際の対象日
  const [pricingFocusDate, setPricingFocusDate] = useState<Date | null>(null)
  // ログアウト確認ダイアログ（F-5）
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const { user, loading, logout, restoreError, retryRestore, canSwitchHotel, hotels } = useAuth()

  // 表示中のタブをブラウザのタブ名に反映する（F-8）
  useEffect(() => {
    document.title = user ? `${TAB_TITLES[activeTab]} | ${APP_NAME}` : APP_NAME
  }, [activeTab, user])

  // 折りたたみ状態を記憶する（デスクトップのみ意味を持つ）
  useEffect(() => {
    if (typeof window === "undefined") return
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true")
  }, [])

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)")
    const closeCompactMenu = () => { if (desktop.matches) setMobileNavOpen(false) }
    desktop.addEventListener("change", closeCompactMenu)
    return () => desktop.removeEventListener("change", closeCompactMenu)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const selectTab = (tab: Tab) => {
    setTab(tab)
    setMobileNavOpen(false)
  }

  // アラートの linkTab は Tab と 1:1 ではないため変換表で解決する（F-4）
  const handleAlertNavigate = (target: AlertLinkTarget) => {
    navigate({ tab: target.tab, analysisView: target.analysisView })
    setMobileNavOpen(false)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // セッション確認が「未ログイン」以外の理由（429/503/ネットワーク断など）で失敗した場合は
  // トークンを保持したまま再試行を促す（F-2）
  if (!user && restoreError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">セッションを確認できませんでした</p>
          <p className="text-sm text-muted-foreground">{restoreError}</p>
        </div>
        <Button onClick={retryRestore}>再試行</Button>
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  // 一時パスワードでログインした直後は、パスワードを変えるまで他の画面を使えない（#89）
  if (user.mustChangePassword) {
    return <ForcePasswordChange />
  }

  // アクセスできるホテルが無いと、どのタブも表示するものが無い。初期設定の画面を出す（#81）
  if (hotels.length === 0) {
    return <NoHotelState />
  }

  const navigation = (<>
        <div
          className={cn(
            "flex items-center border-b border-sidebar-border py-5",
            collapsed ? "justify-center px-3" : "justify-between px-6",
          )}
        >
          <BrandLogo className={cn(collapsed && "lg:hidden")} />

          {/* デスクトップ: 折りたたみ切り替え */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-11 w-11 flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent lg:inline-flex"
            onClick={toggleCollapsed}
            title={collapsed ? "サイドバーを開く" : "サイドバーを折りたたむ"}
            aria-label={collapsed ? "サイドバーを開く" : "サイドバーを折りたたむ"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            )}
          </Button>

          {/* モバイル: 閉じるボタン */}
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent lg:hidden"
            onClick={() => setMobileNavOpen(false)}
            title="メニューを閉じる"
            aria-label="メニューを閉じる"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        {/* ホテル切替（複数ホテルにアクセスできるユーザーのみ表示 — X-5） */}
        {canSwitchHotel && (
          <div className={cn("border-b border-sidebar-border px-4 py-3", collapsed && "lg:px-2")}>
            <HotelSwitcher compact={collapsed} className={cn(collapsed && "lg:flex-col lg:gap-1")} />
          </div>
        )}

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id

            return (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                title={collapsed ? tab.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 min-h-12 rounded-lg px-3 py-3 text-base font-medium transition-colors",
                  collapsed && "lg:justify-center lg:px-0",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" aria-hidden />
                <span className={cn("min-w-0 text-left leading-6", collapsed && "lg:hidden")}>
                  {tab.id === "pricing" ? <><span className="block">ダイナミック</span><span className="block">プライシング</span></> : tab.label}
                </span>
              </button>
            )
          })}
        </nav>

        <div className="space-y-2 border-t border-sidebar-border p-4">
          <button
            onClick={() => selectTab("settings")}
            title={collapsed ? "設定" : undefined}
            aria-current={activeTab === "settings" ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-3 min-h-12 rounded-lg px-3 py-3 text-base font-medium transition-colors",
              collapsed && "lg:justify-center lg:px-0",
              activeTab === "settings"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Settings className="h-5 w-5 flex-shrink-0" aria-hidden />
            <span className={cn(collapsed && "lg:hidden")}>設定</span>
          </button>

          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-2",
              collapsed ? "lg:justify-center" : "justify-between",
            )}
          >
            <div className={cn("min-w-0", collapsed && "lg:hidden")}>
              <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
              {user.role !== "PLATFORM_ADMIN" && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={() => setLogoutConfirmOpen(true)}
              title="ログアウト"
              aria-label="ログアウト"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className={cn("pt-2 text-xs text-muted-foreground", collapsed && "lg:hidden")}>
            <p>© 2026 ホテレベ</p>
          </div>
        </div>
  </>)

  return (
    <div className="flex h-dvh bg-background overflow-hidden [contain:paint]">
      <a href="#main-content" className="skip-link">本文へ移動</a>
      <aside aria-label="メインナビゲーション" className={cn("hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex", collapsed ? "w-[72px]" : "w-[280px]")}>
        {navigation}
      </aside>
      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); menuButtonRef.current?.focus() }} className="inset-y-0 left-0 top-0 flex h-dvh w-[min(320px,calc(100vw-2rem))] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none">
          <DialogTitle className="sr-only">メインメニュー</DialogTitle>
          <DialogDescription className="sr-only">表示する画面を選択してください</DialogDescription>
          {navigation}
        </DialogContent>
      </Dialog>


      <div className="flex min-w-0 flex-1 flex-col">
        {/* モバイル用トップバー */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sidebar-border bg-sidebar px-4 py-2 lg:hidden">
          <BrandLogo />
          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            className="h-11 w-11 flex-shrink-0"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
            title="メニューを開く"
            aria-label="メニューを開く"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <DemoModeBanner />
        <TrialBanner />

        {/* Main Content Area */}
        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-24 outline-none">
          {/* タブごとにエラー境界で囲む。key でタブを切り替えたら境界の状態も戻す（#91） */}
          <ErrorBoundary key={activeTab}>
            {activeTab === "dashboard" && <DashboardTab onAlertNavigate={handleAlertNavigate} />}
            {activeTab === "pricing" && (
              <PricingTab focusDate={pricingFocusDate} onFocusDateHandled={() => setPricingFocusDate(null)} />
            )}
            {activeTab === "analysis" && (
              <AnalysisTab
                onNavigateToPricing={(date) => {
                  setPricingFocusDate(date)
                  setPeriodMonth(
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
                  )
                  selectTab("pricing")
                }}
              />
            )}
            {activeTab === "reports" && <ReportsTab />}
            {activeTab === "ai-summary" && <AISummaryTab />}
            {activeTab === "settings" && <SettingsTab />}
          </ErrorBoundary>
        </main>
      </div>

      {/* Chat Button - Bottom Right */}
      <Button
        ref={chatButtonRef}
        size="icon"
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 h-14 w-14 rounded-full shadow-xs sm:right-6"
        onClick={() => setChatOpen(!chatOpen)}
        aria-label={chatOpen ? "AIアシスタントを閉じる" : "AIアシスタントを開く"}
        aria-expanded={chatOpen}
      >
        <MessageCircle className="h-6 w-6" aria-hidden />
      </Button>

      {/* Chat Interface */}
      <ChatInterface isOpen={chatOpen} onClose={() => setChatOpen(false)} returnFocusRef={chatButtonRef} />

      {/* ログアウトの確認（F-5） */}
      <ConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        title="ログアウトしますか？"
        description="保存していない入力内容は失われます。"
        confirmLabel="ログアウト"
        onConfirm={() => {
          setLogoutConfirmOpen(false)
          void logout()
        }}
      />
    </div>
  )
}
