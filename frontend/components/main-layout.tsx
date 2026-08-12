"use client"

import { useState } from "react"
import { LayoutDashboard, TrendingUp, Calendar, BarChart3, FileText, MessageCircle, Settings, Brain, LogOut, Loader2 } from "lucide-react"
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

export function MainLayout() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard")
  const [chatOpen, setChatOpen] = useState(false)
  const { user, loading, logout } = useAuth()

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
    <div className="flex h-screen bg-background">
      {/* Left Sidebar Navigation */}
      <aside className="w-66 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-sidebar-border">
          <span className="inline-block h-2 w-2 rounded-full bg-primary" aria-hidden />
          <h1 className="font-heading text-[15px] font-medium tracking-tight text-sidebar-foreground">
            AI Revenue Management
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-2">
          <button
            onClick={() => setActiveTab("settings")}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-colors",
              activeTab === "settings"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Settings className="w-5 h-5 flex-shrink-0" />
            <span>設定</span>
          </button>

          <div className="flex items-center justify-between gap-2 rounded-full px-2 py-2">
            <div className="min-w-0">
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

          <div className="text-xs text-muted-foreground pt-2">
            <p>© 2025 Hotel Revenue System</p>
          </div>
        </div>
      </aside>

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

      {/* Chat Button - Bottom Right */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-[var(--shadow-xl)] z-50"
        onClick={() => setChatOpen(!chatOpen)}
      >
        <MessageCircle className="h-6 w-6" />
      </Button>

      {/* Chat Interface */}
      <ChatInterface isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
