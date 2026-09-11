"use client"

// 画面状態（タブ・対象年月・分析サブビュー）のURL同期（U-8）
//
// 状態は URL クエリ（?tab=&year=&month=&view=）を唯一の出所として保持する。
// useState に二重管理しないため、リロード・ブラウザバック・ディープリンクがそのまま動く。
// 対象年月は全タブで共有し、タブを切り替えても見ている月が変わらないようにする。

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { Tab } from "@shared/types"
import type { AnalysisView } from "@/lib/alert-link"
import { toMonthStr } from "@/lib/date"

const TABS: Tab[] = ["dashboard", "pricing", "analysis", "reports", "ai-summary", "settings"]
const ANALYSIS_VIEWS: AnalysisView[] = [
  "performance",
  "composition",
  "booking",
  "competitor",
  "free",
]

const DEFAULT_TAB: Tab = "dashboard"
const DEFAULT_VIEW: AnalysisView = "performance"

interface AppStateValue {
  tab: Tab
  setTab: (tab: Tab) => void
  /** 全タブ共有の対象年 */
  year: number
  /** 全タブ共有の対象月（1-12） */
  month: number
  /** 対象年月の "YYYY-MM" 表現 */
  periodMonth: string
  setPeriod: (year: number, month: number) => void
  setPeriodMonth: (value: string) => void
  /** 分析タブのサブビュー */
  analysisView: AnalysisView
  setAnalysisView: (view: AnalysisView) => void
  /** タブとサブビューを同時に切り替える（アラートからの遷移用） */
  navigate: (target: { tab: Tab; analysisView?: AnalysisView; periodMonth?: string }) => void
}

const AppStateContext = createContext<AppStateValue | undefined>(undefined)

function parseTab(value: string | null): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : DEFAULT_TAB
}

function parseView(value: string | null): AnalysisView {
  return ANALYSIS_VIEWS.includes(value as AnalysisView) ? (value as AnalysisView) : DEFAULT_VIEW
}

function parseYear(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10)
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback
}

function parseMonth(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10)
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : fallback
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const now = useMemo(() => new Date(), [])
  const tab = parseTab(searchParams.get("tab"))
  const year = parseYear(searchParams.get("year"), now.getFullYear())
  const month = parseMonth(searchParams.get("month"), now.getMonth() + 1)
  const analysisView = parseView(searchParams.get("view"))

  const apply = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value == null) params.delete(key)
        else params.set(key, value)
      }
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const value = useMemo<AppStateValue>(() => {
    const periodMonth = toMonthStr(new Date(year, month - 1, 1))
    const setPeriod = (nextYear: number, nextMonth: number) =>
      apply({ year: String(nextYear), month: String(nextMonth) })

    return {
      tab,
      setTab: (next) => apply({ tab: next }),
      year,
      month,
      periodMonth,
      setPeriod,
      setPeriodMonth: (nextValue) => {
        const [y, m] = nextValue.split("-").map(Number)
        if (Number.isInteger(y) && Number.isInteger(m)) setPeriod(y, m)
      },
      analysisView,
      setAnalysisView: (next) => apply({ view: next }),
      navigate: (target) => {
        const patch: Record<string, string | null> = { tab: target.tab }
        if (target.analysisView) patch.view = target.analysisView
        if (target.periodMonth) {
          const [y, m] = target.periodMonth.split("-").map(Number)
          if (Number.isInteger(y) && Number.isInteger(m)) {
            patch.year = String(y)
            patch.month = String(m)
          }
        }
        apply(patch)
      },
    }
  }, [tab, year, month, analysisView, apply])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) {
    throw new Error("useAppState は AppStateProvider の内側でのみ使用できます")
  }
  return ctx
}

/** 対象年月だけが必要な画面向けのショートカット */
export function usePeriod() {
  const { year, month, periodMonth, setPeriod, setPeriodMonth } = useAppState()
  return { year, month, periodMonth, setPeriod, setPeriodMonth }
}
