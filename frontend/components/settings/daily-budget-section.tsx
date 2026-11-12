"use client"

// 日別予算（D-13）。日の予算を持つ施設が、月ごとに日の予算（室数・売上）を登録する。
// GET /settings/daily-budgets で月の登録済みの日を読み、PUT /settings/daily-budgets で変えた日だけを送る（MANAGER 以上）。
// 空欄は「登録しない」。登録済みの日を両方空欄にして保存すると、その日の登録を消す（月の予算の配分に戻る）。
// CSV（日付・予算室数・予算売上）の取り込みもできる。この API には dryRun が無いため、確認は画面の中で行ってから保存する。

import { useEffect, useMemo, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { LabeledMonthPicker } from "@/components/month-picker"
import { useAuth } from "@/components/auth-provider"
import { CsvImportCard, type ImportSummary } from "@/components/settings/csv-import-card"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError, type DailyBudgetRow } from "@/lib/api"
import { DAY_NAMES, daysInMonth, parseMonthStr, toMonthStr } from "@/lib/date"
import { formatRooms, formatYen } from "@/lib/format"
import { DAILY_BUDGET_CSV_TEMPLATE, parseDailyBudgetCsv, type DailyBudgetCsvRow } from "@/lib/import-csv"
import { canManage, ROLE_LABELS } from "@shared/types"

/** PUT /settings/daily-budgets が1回に受け付ける日数（backend の MAX_QUERY_RANGE_DAYS） */
const MAX_DAYS_PER_SAVE = 366

type Draft = Record<string, { rooms: string; revenue: string }>

const pad = (n: number) => String(n).padStart(2, "0")

/** 月の日付（YYYY-MM-DD）の一覧 */
export function monthDates(year: number, month: number): string[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)
}

function buildDraft(dates: string[], rows: DailyBudgetRow[]): Draft {
  const byDate = new Map(rows.map((r) => [r.date.slice(0, 10), r]))
  const draft: Draft = {}
  for (const date of dates) {
    const row = byDate.get(date)
    draft[date] = {
      rooms: row?.budgetRooms == null ? "" : String(row.budgetRooms),
      revenue: row?.budgetRevenue == null ? "" : String(row.budgetRevenue),
    }
  }
  return draft
}

/** 入力を数値に。空欄は null。不正なら error */
export function parseBudgetCell(raw: string, kind: "rooms" | "revenue"): { value: number | null; error?: string } {
  const trimmed = raw.replace(/[,，]/g, "").trim()
  if (trimmed === "") return { value: null }
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return { value: null, error: "0以上の数値で入力してください" }
  if (kind === "rooms" && !Number.isInteger(n)) return { value: null, error: "室数は整数で入力してください" }
  return { value: n }
}

function summarize(rows: DailyBudgetCsvRow[]): Pick<ImportSummary, "startDate" | "endDate"> {
  const dates = rows.map((r) => r.date).sort()
  return { startDate: dates[0] ?? "", endDate: dates[dates.length - 1] ?? "" }
}

export function DailyBudgetSection() {
  const { hotelId, user } = useAuth()
  const canEdit = canManage(user?.role)
  const [monthStr, setMonthStr] = useState(() => toMonthStr(new Date()))
  const { year, month } = parseMonthStr(monthStr)
  const dates = useMemo(() => monthDates(year, month), [year, month])

  const { data, loading, error, reload } = useApiQuery<DailyBudgetRow[]>(
    hotelId ? () => api.dailyBudgets(hotelId, year, month) : null,
    [hotelId, year, month],
    "日別予算の取得に失敗しました",
  )
  // 読み込んだ条件（保存先の取り違えを防ぐ — #91）
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const original = useMemo(() => (data ? buildDraft(dates, data) : {}), [data, dates])
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(original)
    setLoadedFor(data ? `${hotelId}:${monthStr}` : null)
    // original は data と dates から決まる
  }, [original, data, hotelId, monthStr])

  const errors = useMemo(() => {
    const found: Record<string, string> = {}
    for (const [date, row] of Object.entries(draft)) {
      const rooms = parseBudgetCell(row.rooms, "rooms")
      const revenue = parseBudgetCell(row.revenue, "revenue")
      if (rooms.error) found[`${date}.rooms`] = rooms.error
      if (revenue.error) found[`${date}.revenue`] = revenue.error
    }
    return found
  }, [draft])

  const changed = useMemo(
    () => dates.filter((d) => draft[d] && original[d] && (draft[d].rooms !== original[d].rooms || draft[d].revenue !== original[d].revenue)),
    [dates, draft, original],
  )
  const registeredCount = (data ?? []).length
  const hasErrors = Object.keys(errors).length > 0

  const handleChange = (date: string, field: "rooms" | "revenue", value: string) => {
    setDraft((prev) => ({ ...prev, [date]: { ...prev[date], [field]: value } }))
  }

  const save = async () => {
    if (!hotelId || loadedFor !== `${hotelId}:${monthStr}`) return
    if (changed.length === 0) {
      toast.info("変更された日がありません")
      return
    }
    if (hasErrors) {
      toast.error("入力内容にエラーがあります。赤字のメッセージを確認してください")
      return
    }
    const days: DailyBudgetRow[] = changed.map((date) => ({
      date,
      budgetRooms: parseBudgetCell(draft[date].rooms, "rooms").value,
      budgetRevenue: parseBudgetCell(draft[date].revenue, "revenue").value,
    }))
    setSaving(true)
    try {
      const result = await api.saveDailyBudgets(hotelId, days)
      toast.success(`${year}年${month}月の日別予算を保存しました`, {
        description: `登録 ${result.saved}日・登録の解除 ${result.cleared}日`,
      })
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "日別予算の保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>日別予算</CardTitle>
              <CardDescription>
                日の予算（室数・売上）を持っている場合に登録します。登録した日を優先し、月の予算の残りを、3か月以内はAIの予測、それより先は前年同曜日の比で配ります。
                空欄の日は登録しません。登録済みの日の室数・売上を両方とも空欄にして保存すると、その日の登録を消します。
                {!canEdit && `（編集には${ROLE_LABELS.MANAGER}以上の権限が必要です）`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LabeledMonthPicker id="daily-budget-month" label="対象月" value={monthStr} onChange={setMonthStr} disabled={saving} />
              {canEdit && (
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => void save()}
                  disabled={saving || loading || !!error || changed.length === 0}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                  保存{changed.length > 0 ? `（${changed.length}日）` : ""}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {registeredCount > 0 ? `この月は ${registeredCount}日 登録されています。` : "この月はまだ登録されていません（月の予算を配っています）。"}
              </p>
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="px-2 py-1.5 text-left font-normal">日付</th>
                      <th className="px-2 py-1.5 text-left font-normal">予算室数</th>
                      <th className="px-2 py-1.5 text-left font-normal">予算売上（円）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map((date) => {
                      const d = Number(date.slice(8, 10))
                      const dow = new Date(year, month - 1, d).getDay()
                      const row = draft[date] ?? { rooms: "", revenue: "" }
                      const isChanged = changed.includes(date)
                      return (
                        <tr key={date} className={isChanged ? "border-b bg-primary/5" : "border-b last:border-0"}>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums">
                            {month}/{d}（{DAY_NAMES[dow]}）
                          </td>
                          {(["rooms", "revenue"] as const).map((field) => {
                            const key = `${date}.${field}`
                            const label = `${month}月${d}日の${field === "rooms" ? "予算室数" : "予算売上"}`
                            return (
                              <td key={field} className="px-2 py-1">
                                {canEdit ? (
                                  <>
                                    <Input
                                      inputMode="numeric"
                                      className="h-8 w-full max-w-[160px] text-right tabular-nums"
                                      aria-label={label}
                                      aria-invalid={errors[key] ? true : undefined}
                                      value={row[field]}
                                      onChange={(e) => handleChange(date, field, e.target.value)}
                                      disabled={saving}
                                    />
                                    {errors[key] && <p className="mt-0.5 text-[11px] text-destructive">{errors[key]}</p>}
                                  </>
                                ) : (
                                  <span className="tabular-nums">
                                    {row[field] === "" ? "-" : field === "rooms" ? formatRooms(Number(row[field])) : formatYen(Number(row[field]))}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CsvImportCard<DailyBudgetCsvRow>
        title="日別予算の取り込み"
        description={
          <>
            日付・予算室数・予算売上の CSV で、まとめて登録します（1回に{MAX_DAYS_PER_SAVE}日まで・月をまたいでも可）。
            予算室数と予算売上の両方が空欄の行は、その日の登録を消します。確認の後に「取り込む」で保存します。
          </>
        }
        templateFileName="日別予算テンプレート.csv"
        template={DAILY_BUDGET_CSV_TEMPLATE}
        maxRows={MAX_DAYS_PER_SAVE}
        parse={parseDailyBudgetCsv}
        unit="日"
        submit={async (id, rows, dryRun) => {
          const range = summarize(rows)
          const toClear = rows.filter((r) => r.budgetRooms == null && r.budgetRevenue == null).length
          // この API には dryRun が無い。確認では件数を画面の中で数えるだけ
          if (dryRun) return { total: rows.length, created: rows.length - toClear, updated: toClear, ...range }
          const result = await api.saveDailyBudgets(id, rows)
          return { total: rows.length, created: result.saved, updated: result.cleared, ...range }
        }}
        describe={(summary, phase) =>
          phase === "preview"
            ? `登録（すでにある日は上書き） ${summary.created}日・登録を消す ${summary.updated}日`
            : `登録 ${summary.created}日・登録の解除 ${summary.updated}日`
        }
        onImported={() => void reload()}
      />
    </div>
  )
}
