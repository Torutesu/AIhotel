"use client"

import { useEffect, useState } from "react"
import {
  LayoutDashboard,
  TrendingUp,
  Calendar,
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DashboardTab } from "@/components/tabs/dashboard-tab"
import { PricingTab } from "@/components/tabs/pricing-tab"
import { DailyAnalysisTab } from "@/components/tabs/daily-analysis-tab"
import { AnalysisTab } from "@/components/tabs/analysis-tab"
import { ReportsTab } from "@/components/tabs/reports-tab"
import { SettingsTab } from "@/components/tabs/settings-tab"
import { AISummaryTab } from "@/components/tabs/ai-summary-tab"
import { ChatInterface } from "@/components/chat-interface"
import { DemoModeBanner } from "@/components/demo-mode-banner"
import { useAuth } from "@/components/auth-provider"
import { LoginForm } from "@/components/login-form"
import type { Tab } from "@shared/types"

const tabs = [
  { id: "dashboard" as const, label: "ダッシュボード", icon: LayoutDashboard },
  { id: "pricing" as const, label: "ダイナミックプライシング", icon: TrendingUp },
  { id: "daily" as const, label: "日別分析", icon: Calendar },
  { id: "analysis" as const, label: "各種分析", icon: BarChart3 },
  { id: "reports" as const, label: "レポート", icon: FileText },
  { id: "ai-summary" as const, label: "AIまとめ", icon: Brain },
]

const SIDEBAR_COLLAPSED_KEY = "hrms.sidebarCollapsed"

export function MainLayout() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard")
  const [chatOpen, setChatOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { user, loading, logout } = useAuth()

  // 折りたたみ状態を記憶する（デスクトップのみ意味を持つ）
  useEffect(() => {
    if (typeof window === "undefined") return
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true")
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const selectTab = (tab: Tab) => {
    setActiveTab(tab)
    setMobileNavOpen(false)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* モバイル用オーバーレイ背景 */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={cn(
          "z-50 flex w-72 flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
          "fixed inset-y-0 left-0 md:static md:w-66",
          collapsed && "md:w-[72px]",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div
          className={cn(
            "flex items-center border-b border-sidebar-border py-5",
            collapsed ? "justify-center px-3" : "justify-between px-6",
          )}
        >
          <div className={cn("flex min-w-0 items-center gap-2", collapsed && "md:hidden")}>
            <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-primary" aria-hidden />
            <h1 className="truncate font-heading text-[15px] font-medium tracking-tight text-sidebar-foreground">
              ホテレベ
            </h1>
          </div>

          {/* デスクトップ: 折りたたみ切り替え */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-8 w-8 flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent md:inline-flex"
            onClick={toggleCollapsed}
            title={collapsed ? "サイドバーを開く" : "サイドバーを折りたたむ"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>

          {/* モバイル: 閉じるボタン */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent md:hidden"
            onClick={() => setMobileNavOpen(false)}
            title="メニューを閉じる"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id

            return (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                title={collapsed ? tab.label : undefined}
                className={cn(
                  "flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                  collapsed && "md:justify-center md:px-0",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className={cn(collapsed && "md:hidden")}>{tab.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="space-y-2 border-t border-sidebar-border p-4">
          <button
            onClick={() => selectTab("settings")}
            title={collapsed ? "設定" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
              collapsed && "md:justify-center md:px-0",
              activeTab === "settings"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Settings className="h-5 w-5 flex-shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>設定</span>
          </button>

          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-2",
              collapsed ? "md:justify-center" : "justify-between",
            )}
          >
            <div className={cn("min-w-0", collapsed && "md:hidden")}>
              <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={() => logout()}
              title="ログアウト"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          <div className={cn("pt-2 text-xs text-muted-foreground", collapsed && "md:hidden")}>
            <p>© 2026 ホテレベ</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* モバイル用トップバー */}
        <div className="flex items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 py-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => setMobileNavOpen(true)}
            title="メニューを開く"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-primary" aria-hidden />
          <h1 className="truncate font-heading text-[15px] font-medium tracking-tight text-sidebar-foreground">
            ホテレベ
          </h1>
        </div>

        <DemoModeBanner />

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto">
          {activeTab === "dashboard" && <DashboardTab onTabChange={setActiveTab} />}
          {activeTab === "pricing" && <PricingTab />}
          {activeTab === "daily" && <DailyAnalysisTab />}
          {activeTab === "analysis" && <AnalysisTab />}
          {activeTab === "reports" && <ReportsTab />}
          {activeTab === "ai-summary" && <AISummaryTab />}
          {activeTab === "settings" && <SettingsTab />}
        </main>
      </div>

      {/* Chat Button - Bottom Right */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full shadow-xs"
        onClick={() => setChatOpen(!chatOpen)}
      >
        <MessageCircle className="h-6 w-6" />
      </Button>

      {/* Chat Interface */}
      <ChatInterface isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
