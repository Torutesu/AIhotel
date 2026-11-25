"use client"

import { OperationsUsage } from "@/components/operations-usage"
import Link from "next/link"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTheme } from "next-themes"
import { Building2, ChartNoAxesColumn, Clock3, LayoutDashboard, LogOut, Moon, Sun } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { LoginForm } from "@/components/login-form"
import { ForcePasswordChange } from "@/components/onboarding/force-password-change"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ErrorState } from "@/components/error-state"
import { TenantManagementSection } from "@/components/settings/tenant-management-section"
import { OperationsAgencies, OperationsCustomers } from "@/components/operations-directory"
import { demoShared } from "@/lib/api/demo-shared"
import { TrialManagementSection } from "@/components/settings/trials/trial-management-section"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, isDemoModeEnabled } from "@/lib/api"
import { cn } from "@/lib/utils"

const views = [
  { id: "overview", label: "概要", icon: LayoutDashboard, description: "顧客とトライアルの状況を、ひと目で確認。" },
  { id: "customers", label: "顧客一覧", icon: Building2, description: "顧客情報と担当範囲を管理します。" },
  { id: "usage", label: "活用状況", icon: ChartNoAxesColumn, description: "顧客ごとの利用頻度と、機能がどこまで活用されているかを確認します。" },
  { id: "trials", label: "トライアル管理", icon: Clock3, description: "営業先への発行から、期限の延長・停止まで。" },
  { id: "agencies", label: "代理店管理", icon: Building2, description: "代理店のログイン発行・停止とアクセス権限を管理します。" },
] as const

export function OperationsConsole() {
  const { user, loading, restoreError, retryRestore, logout } = useAuth()
  if (loading) return <p role="status" className="p-8">ログイン状態を確認しています…</p>
  if (restoreError) return <ErrorState message={restoreError} onRetry={retryRestore} />
  if (!user) return <LoginForm audience="operations" />
  if (user.role !== "PLATFORM_ADMIN" && !user.operationsAccess) return <main className="mx-auto max-w-lg space-y-5 px-6 py-20"><BrandLogo /><h1 className="text-xl font-semibold">このページにはアクセスできません</h1><p>現在のアカウントには運営権限がありません。</p><Link className="underline" href="/">ホテル画面へ戻る</Link></main>
  if (user.mustChangePassword) return <ForcePasswordChange />
  return <ConsoleContent key={user.id} onLogout={logout} platform={user.role === "PLATFORM_ADMIN"} name={user.operationsAccess?.name ?? user.name} />
}

function ConsoleContent({ onLogout, platform, name }: { onLogout: () => Promise<void>; platform: boolean; name: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const availableViews = views.filter(v => v.id !== "agencies" || (platform && isDemoModeEnabled()))
  const current = availableViews.find(v => v.id === params.get("section")) ?? views[0]
  const { resolvedTheme, setTheme } = useTheme()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const trials = useApiQuery(() => api.trials(), [current.id], "トライアルの利用状況を取得できませんでした")
  const tenants = useApiQuery(() => isDemoModeEnabled() ? demoShared.customers().then(rows => rows.length) : api.tenants().then(rows => rows.length), [current.id], "顧客情報を取得できませんでした")
  const rows = trials.data ?? []
  const active = rows.filter(t => t.status === "ACTIVE")
  const soon = active.filter(t => t.daysLeft <= 7)
  const unseen = active.filter(t => !t.lastLoginAt)
  const navigate = (id: string) => { setQuery(""); setFilter("all"); router.push(`/operations?section=${id}`) }
  const filtered = rows.filter(t => `${t.name} ${t.loginEmail ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || (filter === "unseen" ? !t.lastLoginAt && t.status === "ACTIVE" : t.status === "ACTIVE" && t.daysLeft <= 7)))
  const date = (value: string | null) => value ? new Date(value).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }) : "未ログイン"
  return <div className="min-h-dvh bg-background text-foreground">
    <a href="#operations-main" className="sr-only focus:not-sr-only focus:p-4">本文へ移動</a>
    <aside className="border-b lg:fixed lg:inset-y-0 lg:w-60 lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between px-5 py-5 lg:block"><BrandLogo /><p className="text-xs tracking-widest text-muted-foreground lg:mt-3">運営管理</p></div>
      <nav aria-label="運営メニュー" className="grid grid-cols-2 gap-1 sm:grid-cols-5 px-3 pb-3 lg:grid-cols-1 lg:gap-2 lg:pt-7">{availableViews.map(v => <button key={v.id} onClick={() => navigate(v.id)} aria-current={current.id === v.id ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-1 py-3 text-xs focus-visible:outline focus-visible:outline-2 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:text-sm", current.id === v.id ? "font-semibold underline decoration-2 underline-offset-8" : "text-muted-foreground hover:text-foreground")}><v.icon className="h-4 w-4" aria-hidden /><span className="lg:hidden">{v.id === "trials" ? "トライアル" : v.label}</span><span className="hidden lg:inline">{v.label}</span></button>)}</nav>
      <div className="hidden px-6 text-xs leading-6 text-muted-foreground lg:absolute lg:bottom-6 lg:block">{platform ? "全体管理者：全顧客を表示" : "代理店：自社の担当分のみ表示"}<br />ホテル画面とは別の管理画面です</div>
    </aside>
    <div className="lg:ml-60">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3 sm:px-8"><p className="text-xs text-muted-foreground">{name} · {platform ? "全体管理者" : "代理店"} <span aria-hidden>/</span> {current.label}</p><div className="flex gap-2"><Button variant="ghost" size="icon" aria-label="配色を切り替える" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></Button><Button variant="ghost" size="sm" onClick={() => void onLogout()}><LogOut className="mr-2 h-4 w-4" />ログアウト</Button></div></header>
      <main id="operations-main" className="mx-auto max-w-7xl space-y-7 px-4 py-7 sm:px-8 sm:py-10">
        <div><h1 className="text-2xl font-semibold tracking-tight">{current.label}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{current.description}</p></div>
        {isDemoModeEnabled() && <p className="border-l-2 pl-3 text-xs leading-6 text-muted-foreground">顧客台帳・トライアル・活用状況は実際の登録・利用記録です。トライアル内のホテル業務データはサンプルです。</p>}
        {current.id === "customers" && (isDemoModeEnabled() ? <OperationsCustomers platform={platform} /> : <TenantManagementSection />)}
        {current.id === "agencies" && platform && <OperationsAgencies />}
        {current.id === "trials" && <TrialManagementSection platform={platform && isDemoModeEnabled()} />}
        {current.id === "usage" && <OperationsUsage />}
        {current.id === "overview" && <>
          {trials.error ? <ErrorState message={trials.error} onRetry={trials.reload} /> : trials.loading ? <p role="status">利用状況を読み込んでいます…</p> : <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
              { label: "利用可能なトライアル", value: active.length, suffix: "件" },
              { label: "7日以内に期限終了", value: soon.length, suffix: "件" },
              { label: "発行後、未ログイン", value: unseen.length, suffix: "件" },
              { label: "ログイン実績あり", value: rows.filter(t => t.lastLoginAt).length, suffix: "件" },
            ].map(metric => <div key={metric.label} className="rounded-lg border p-4 sm:p-5"><p className="text-xs leading-5 text-muted-foreground">{metric.label}</p><p className="mt-4 text-3xl font-semibold tabular-nums">{metric.value}<span className="ml-2 text-xs font-normal text-muted-foreground">{metric.suffix}</span></p></div>)}</div>
            {current.id === "overview" && <section className="space-y-4 rounded-lg border p-5 sm:p-6"><h2 className="font-semibold">今日の確認</h2><div className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm leading-6">{soon.length ? `${soon.length}件のトライアルが7日以内に終了します。` : "7日以内に終了するトライアルはありません。"}</p><p className="mt-1 text-xs leading-6 text-muted-foreground">{unseen.length ? `${unseen.length}件はまだログインされていません。案内の到着を確認してください。` : active.length ? "利用可能なトライアルはすべてログイン済みです。" : "現在、利用可能なトライアルはありません。"}</p></div><div className="sm:text-right"><Button variant="outline" onClick={() => navigate("trials")}>トライアルを確認</Button></div></div><div className="border-t pt-4 text-sm text-muted-foreground">{tenants.error ? <ErrorState message={tenants.error} onRetry={tenants.reload} /> : tenants.loading ? "顧客情報を確認しています…" : `顧客台帳 ${tenants.data ?? 0}件（${platform ? "全体" : "自社担当"}）`}</div></section>}
            <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">トライアルの利用状況</h2><Button variant="ghost" size="sm" onClick={() => void trials.reload()}>最新に更新</Button></div><div className="flex flex-col gap-3 sm:flex-row"><Input aria-label="利用状況を検索" placeholder="顧客名・メールアドレスで検索" value={query} onChange={e => setQuery(e.target.value)} className="sm:max-w-sm" /><select aria-label="利用状況で絞り込み" value={filter} onChange={e => setFilter(e.target.value)} className="min-h-11 rounded-md border bg-background px-3 text-sm"><option value="all">すべて</option><option value="soon">7日以内に終了</option><option value="unseen">利用可能・未ログイン</option></select></div>
              <ul className="divide-y rounded-lg border">{filtered.map(t => <li key={t.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_160px_140px] sm:items-center sm:p-5"><div className="min-w-0"><p className="break-words text-sm font-medium">{t.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{t.loginEmail}</p></div><div><p className="text-xs text-muted-foreground">最終ログイン</p><p className="mt-1 text-sm tabular-nums">{date(t.lastLoginAt)}</p></div><div><p className="text-xs text-muted-foreground">利用期限</p><p className="mt-1 text-sm">{t.status === "ACTIVE" ? `残り${t.daysLeft}日` : t.status === "EXPIRED" ? "期限切れ" : "停止中"}</p></div></li>)}{!filtered.length && <li className="p-8 text-center text-sm text-muted-foreground">該当するトライアルはありません。</li>}</ul><p className="text-xs leading-6 text-muted-foreground">日時は日本時間、最終ログインはアカウント単位の記録です。機能別の閲覧・操作回数は「活用状況」で確認できます。滞在時間は計測していません。</p>
            </section>
          </>}
        </>}
      </main>
    </div>
  </div>
}
