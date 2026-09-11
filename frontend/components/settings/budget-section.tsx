"use client"

// 月次予算の編集（X-1 / N-1 / F-SET-04）
//
// GET /settings/budgets?hotelId=&year= が返す12か月ぶんをそのまま表に出し、
// PUT /settings/budgets で変更した月だけを一括保存する（MANAGER以上）。
//
// 稼働率は画面ではパーセント（0〜100）で入力し、送信時に 0〜1 の比率へ変換する。
// バックエンドは送られた月の全項目を置き換えるため、変更した月は必ず全項目を送る。
// 予算室数（budgetRooms）はUIで入力させず、バックエンドが
// 「客室数 × 稼働率 × 月の日数」で導出する。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import {
  api,
  ApiClientError,
  type BudgetYear,
  type MonthlyBudget,
  type UpsertBudgetsRequest,
} from "@/lib/api"
import { formatGuests, formatPercent, formatYen } from "@/lib/format"

/** 入力欄を持つ項目。budgetRooms / lastYearRooms はバックエンドが稼働率から導出する */
type BudgetField =
  | "budgetRevenue"
  | "budgetAdr"
  | "budgetOccupancy"
  | "budgetGuests"
  | "lastYearRevenue"
  | "lastYearAdr"
  | "lastYearOccupancy"
  | "lastYearGuests"

interface FieldDef {
  key: BudgetField
  label: string
  kind: "yen" | "percent" | "count"
  /** 前年実績列（見出しの区切り用） */
  lastYear: boolean
}

const FIELDS: FieldDef[] = [
  { key: "budgetRevenue", label: "売上予算", kind: "yen", lastYear: false },
  { key: "budgetAdr", label: "ADR予算", kind: "yen", lastYear: false },
  { key: "budgetOccupancy", label: "稼働率予算", kind: "percent", lastYear: false },
  { key: "budgetGuests", label: "宿泊人数予算", kind: "count", lastYear: false },
  { key: "lastYearRevenue", label: "前年売上", kind: "yen", lastYear: true },
  { key: "lastYearAdr", label: "前年ADR", kind: "yen", lastYear: true },
  { key: "lastYearOccupancy", label: "前年稼働率", kind: "percent", lastYear: true },
  { key: "lastYearGuests", label: "前年宿泊人数", kind: "count", lastYear: true },
]

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

// インライン検証（U-11 と同じく zod を唯一の検証ロジックにする）
const amountSchema = z
  .number({ invalid_type_error: "数値で入力してください" })
  .min(0, "0以上で入力してください")
const countSchema = z
  .number({ invalid_type_error: "数値で入力してください" })
  .int("整数で入力してください")
  .min(0, "0以上で入力してください")
/** 稼働率は画面上はパーセント（0〜100）。送信時に 0〜1 へ変換する */
const percentSchema = z
  .number({ invalid_type_error: "数値で入力してください" })
  .min(0, "0以上で入力してください")
  .max(100, "0〜100の範囲で入力してください")

function schemaFor(kind: FieldDef["kind"]) {
  if (kind === "percent") return percentSchema
  if (kind === "count") return countSchema
  return amountSchema
}

/** 入力文字列を検証する。空欄は「未設定」として null を返す */
function parseCell(raw: string, kind: FieldDef["kind"]): { value: number | null; error?: string } {
  const trimmed = raw.trim()
  if (trimmed === "") return { value: null }
  const num = Number(trimmed)
  if (!Number.isFinite(num)) return { value: null, error: "数値で入力してください" }
  const result = schemaFor(kind).safeParse(num)
  if (!result.success) return { value: null, error: result.error.issues[0]?.message }
  return { value: result.data }
}

/** API の値（稼働率は 0〜1）を入力欄の文字列（稼働率はパーセント）に変換する */
function toInputValue(budget: MonthlyBudget | null, field: FieldDef): string {
  if (!budget) return ""
  const raw = budget[field.key]
  if (raw == null) return ""
  if (field.kind === "percent") return String(Math.round(raw * 1000) / 10)
  return String(raw)
}

type DraftRow = Record<BudgetField, string>

function buildDraft(data: BudgetYear): Record<number, DraftRow> {
  const draft: Record<number, DraftRow> = {}
  for (const entry of data.months) {
    draft[entry.month] = FIELDS.reduce((row, field) => {
      row[field.key] = toInputValue(entry.budget, field)
      return row
    }, {} as DraftRow)
  }
  return draft
}

const cellKey = (month: number, field: BudgetField) => `${month}.${field}`

/** 読み取り専用表示（OPERATOR）。単位付きで整形する */
function readOnlyText(raw: string, kind: FieldDef["kind"]): string {
  if (raw.trim() === "") return "-"
  const num = Number(raw)
  if (!Number.isFinite(num)) return raw
  if (kind === "yen") return formatYen(num)
  if (kind === "count") return formatGuests(num)
  return formatPercent(num / 100)
}

export function BudgetSection() {
  const { hotelId, user } = useAuth()
  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER"

  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<BudgetYear | null>(null)
  const [draft, setDraft] = useState<Record<number, DraftRow>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const years = useMemo(
    () => [currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2],
    [currentYear],
  )

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.budgets(hotelId, year)
      setData(result)
      setDraft(buildDraft(result))
      setErrors({})
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "予算の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, year])

  useEffect(() => {
    load()
  }, [load])

  const original = useMemo(() => (data ? buildDraft(data) : {}), [data])

  /** 値が変わった月（保存対象） */
  const changedMonths = useMemo(() => {
    return MONTHS.filter((month) => {
      const before = original[month]
      const after = draft[month]
      if (!before || !after) return false
      return FIELDS.some((field) => (before[field.key] ?? "") !== (after[field.key] ?? ""))
    })
  }, [draft, original])

  /** 既に予算が登録されている月（上書き確認の対象） */
  const registeredMonths = useMemo(() => {
    const set = new Set<number>()
    for (const entry of data?.months ?? []) {
      if (entry.budget) set.add(entry.month)
    }
    return set
  }, [data])

  const overwriteMonths = changedMonths.filter((m) => registeredMonths.has(m))

  const handleChange = (month: number, field: FieldDef, value: string) => {
    setDraft((prev) => ({ ...prev, [month]: { ...prev[month], [field.key]: value } }))
    const { error: cellError } = parseCell(value, field.kind)
    setErrors((prev) => {
      const next = { ...prev }
      if (cellError) next[cellKey(month, field.key)] = cellError
      else delete next[cellKey(month, field.key)]
      return next
    })
  }

  /** 全セルを検証する。1つでも不正なら保存しない */
  const validateAll = (): boolean => {
    const found: Record<string, string> = {}
    for (const month of MONTHS) {
      const row = draft[month]
      if (!row) continue
      for (const field of FIELDS) {
        const { error: cellError } = parseCell(row[field.key] ?? "", field.kind)
        if (cellError) found[cellKey(month, field.key)] = cellError
      }
    }
    setErrors(found)
    return Object.keys(found).length === 0
  }

  const buildPayload = (): UpsertBudgetsRequest | null => {
    if (!hotelId) return null
    const months: UpsertBudgetsRequest["months"] = changedMonths.map((month) => {
      const row = draft[month]
      const entry: UpsertBudgetsRequest["months"][number] = { month }
      for (const field of FIELDS) {
        const { value } = parseCell(row[field.key] ?? "", field.kind)
        // 稼働率はパーセント入力を 0〜1 の比率に戻す（バックエンドの保存スケール）
        entry[field.key] = value != null && field.kind === "percent" ? value / 100 : value
      }
      return entry
    })
    return { hotelId, year, months }
  }

  const save = async () => {
    const payload = buildPayload()
    if (!payload) return
    setSaving(true)
    try {
      const result = await api.saveBudgets(payload)
      setData(result)
      setDraft(buildDraft(result))
      setErrors({})
      toast.success(`${year}年の予算を保存しました`, {
        description: `${payload.months.length}か月ぶんを更新しました。`,
      })
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "予算の保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (changedMonths.length === 0) {
      toast.info("変更された月がありません")
      return
    }
    if (!validateAll()) {
      toast.error("入力内容にエラーがあります。赤字のメッセージを確認してください")
      return
    }
    // 既存の予算を上書きする場合のみ確認を挟む（F-5）
    if (overwriteMonths.length > 0) {
      setConfirmOpen(true)
      return
    }
    void save()
  }

  const unregisteredCount = 12 - registeredMonths.size

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>予算</CardTitle>
            <CardDescription>
              月次の売上・ADR・稼働率・宿泊人数の予算と前年実績を管理します
              {!canEdit && "（編集にはMANAGER以上の権限が必要です）"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="budget-year" className="whitespace-nowrap text-xs">
              対象年
            </Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger id="budget-year" className="h-8 w-24 text-xs" aria-label="対象年">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-80 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {unregisteredCount === 0
                  ? "12か月すべて登録済みです"
                  : `未登録: ${unregisteredCount}か月`}
              </span>
              <span aria-hidden>/</span>
              <span>稼働率はパーセント（0〜100）で入力します</span>
              <span aria-hidden>/</span>
              <span>予算室数は稼働率と客室数から自動計算されます</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="sticky left-0 z-10 border-r bg-muted/30 px-2 py-1.5 text-left font-medium">
                      月
                    </th>
                    <th className="border-r px-2 py-1.5 text-left font-medium">状態</th>
                    {FIELDS.map((field) => (
                      <th
                        key={field.key}
                        className={`whitespace-nowrap border-r px-2 py-1.5 text-right font-medium ${
                          field.lastYear ? "text-muted-foreground" : ""
                        }`}
                      >
                        {field.label}
                        {field.kind === "percent" && <span className="ml-0.5">(%)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((month) => {
                    const row = draft[month]
                    const registered = registeredMonths.has(month)
                    const changed = changedMonths.includes(month)
                    return (
                      <tr key={month} className="border-b align-top hover:bg-muted/20">
                        <td className="sticky left-0 z-10 whitespace-nowrap border-r bg-card px-2 py-1.5 font-medium">
                          {month}月
                        </td>
                        <td className="whitespace-nowrap border-r px-2 py-1.5">
                          {registered ? (
                            <span className="text-muted-foreground">登録済み</span>
                          ) : (
                            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                              未登録
                            </span>
                          )}
                          {changed && (
                            <span className="ml-1 text-[10px] font-medium text-primary">未保存</span>
                          )}
                        </td>
                        {FIELDS.map((field) => {
                          const value = row?.[field.key] ?? ""
                          const cellError = errors[cellKey(month, field.key)]
                          const inputId = `budget-${month}-${field.key}`
                          return (
                            <td key={field.key} className="border-r px-1 py-1">
                              {canEdit ? (
                                <>
                                  <Label htmlFor={inputId} className="sr-only">
                                    {month}月の{field.label}
                                  </Label>
                                  <Input
                                    id={inputId}
                                    type="number"
                                    min={0}
                                    max={field.kind === "percent" ? 100 : undefined}
                                    step={field.kind === "percent" ? 0.1 : 1}
                                    inputMode="decimal"
                                    className="h-7 w-28 text-right text-xs"
                                    value={value}
                                    aria-invalid={cellError ? true : undefined}
                                    aria-describedby={cellError ? `${inputId}-error` : undefined}
                                    onChange={(e) => handleChange(month, field, e.target.value)}
                                  />
                                  {cellError && (
                                    <p
                                      id={`${inputId}-error`}
                                      role="alert"
                                      className="mt-0.5 w-28 text-[10px] leading-tight text-destructive"
                                    >
                                      {cellError}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <span className="block px-1 py-1 text-right">
                                  {readOnlyText(value, field.kind)}
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

            {canEdit && (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <p className="text-xs text-muted-foreground">
                  {changedMonths.length === 0
                    ? "変更はありません"
                    : `${changedMonths.length}か月に未保存の変更があります`}
                </p>
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={saving || changedMonths.length === 0}
                  onClick={handleSaveClick}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden />
                  )}
                  予算を保存
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* 既存の予算を上書きする場合の確認（F-5） */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="登録済みの予算を上書きしますか？"
        description={`${year}年 ${overwriteMonths.map((m) => `${m}月`).join("・")} には既に予算が登録されています。保存すると現在の値で置き換えられます。`}
        confirmLabel="上書きして保存"
        destructive={false}
        onConfirm={() => {
          setConfirmOpen(false)
          void save()
        }}
      />
    </Card>
  )
}
