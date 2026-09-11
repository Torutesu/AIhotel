"use client"

// 料金ランク設定（U-3 / U-11 / U-15 / F-SET-02）
// 一覧・追加（POST）・編集（PUT）・削除（DELETE）。最大40段階をUIで強制する。
// 人数別価格は 1名 ≤ 2名 ≤ 3名 ≤ 4名 を zod でインライン検証する。

import { useCallback, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { Edit2, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { FormFieldError } from "@/components/form-field-error"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type PriceRank } from "@/lib/api"
import { formatYen } from "@/lib/format"
import { zodResolver } from "@/lib/zod-resolver"

/** 料金ランクの上限（F-SET-02。バリデータ・seed と揃える） */
export const MAX_PRICE_RANKS = 40

const priceField = (label: string) =>
  z
    .number({ invalid_type_error: `${label}は数値で入力してください` })
    .int(`${label}は整数で入力してください`)
    .min(0, `${label}は0以上で入力してください`)

/** 空欄を「未設定」(null) として扱う料金フィールド（R-2） */
const optionalPriceField = (label: string) => priceField(label).nullable()

const rankFormSchema = z
  .object({
    label: z.string().trim().min(1, "ラベルを入力してください").max(10, "ラベルは10文字以内で入力してください"),
    price1P: priceField("1名料金"),
    price2P: priceField("2名料金"),
    // 3名・4名は「未設定」を許す。空欄は null（未設定）として保存する（R-2）
    price3P: optionalPriceField("3名料金"),
    price4P: optionalPriceField("4名料金"),
  })
  .superRefine((data, ctx) => {
    // 人数が増えるほど料金が下がる設定は入力ミスの可能性が高いため弾く
    if (data.price2P < data.price1P) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price2P"],
        message: "2名料金は1名料金以上で入力してください",
      })
    }
    if (data.price3P != null && data.price3P < data.price2P) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price3P"],
        message: "3名料金は2名料金以上で入力してください",
      })
    }
    if (data.price4P != null && data.price3P != null && data.price4P < data.price3P) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price4P"],
        message: "4名料金は3名料金以上で入力してください",
      })
    }
  })

type RankFormValues = z.infer<typeof rankFormSchema>

const PRICE_FIELDS: Array<{
  key: keyof RankFormValues & `price${string}`
  label: string
  /** 空欄を「未設定」として保存できるか（3名・4名のみ） */
  optional?: boolean
}> = [
  { key: "price1P", label: "1名料金" },
  { key: "price2P", label: "2名料金" },
  { key: "price3P", label: "3名料金", optional: true },
  { key: "price4P", label: "4名料金", optional: true },
]

export function PriceRankSection() {
  const { hotelId, user } = useAuth()
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [priceRanks, setPriceRanks] = useState<PriceRank[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** ダイアログの対象。"create" なら新規追加、PriceRank なら編集 */
  const [target, setTarget] = useState<PriceRank | "create" | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PriceRank | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RankFormValues>({
    resolver: zodResolver(rankFormSchema),
    defaultValues: { label: "", price1P: 0, price2P: 0, price3P: 0, price4P: 0 },
    mode: "onBlur",
  })

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setPriceRanks(await api.priceRanks(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "料金ランクの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  /** 次に採番するランク番号（既存の最大＋1） */
  const nextRankNumber = priceRanks.reduce((max, r) => Math.max(max, r.rank), 0) + 1
  const canAdd = canManage && nextRankNumber <= MAX_PRICE_RANKS

  const openCreate = () => {
    reset({
      label: `R${String(nextRankNumber).padStart(2, "0")}`,
      price1P: 0,
      price2P: 0,
      price3P: null,
      price4P: null,
    })
    setTarget("create")
  }

  const openEdit = (rank: PriceRank) => {
    reset({
      label: rank.label,
      price1P: rank.price1P,
      price2P: rank.price2P,
      price3P: rank.price3P ?? null,
      price4P: rank.price4P ?? null,
    })
    setTarget(rank)
  }

  const onSubmit = async (values: RankFormValues) => {
    if (!hotelId || !target) return
    setSaving(true)
    try {
      if (target === "create") {
        if (nextRankNumber > MAX_PRICE_RANKS) {
          toast.error(`料金ランクは最大${MAX_PRICE_RANKS}段階です`)
          return
        }
        await api.createPriceRank({ hotelId, rank: nextRankNumber, ...values })
        toast.success("料金ランクを追加しました")
      } else {
        await api.updatePriceRank(target.id, hotelId, values)
        toast.success("料金ランクを更新しました")
      }
      setTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "料金ランクの保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (rank: PriceRank) => {
    if (!hotelId) return
    setDeletingId(rank.id)
    try {
      await api.deletePriceRank(rank.id, hotelId)
      toast.success("料金ランクを削除しました")
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "料金ランクの削除に失敗しました")
    } finally {
      setDeletingId(null)
    }
  }

  const isCreate = target === "create"
  const dialogRankNumber = isCreate ? nextRankNumber : target?.rank

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>料金ランク設定</CardTitle>
            <CardDescription>
              最大{MAX_PRICE_RANKS}段階の料金ランクを管理します（現在 {priceRanks.length} 段階）
              {!canManage && "（編集にはMANAGER以上の権限が必要です）"}
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={openCreate}
              disabled={!canAdd || loading}
              title={canAdd ? undefined : `料金ランクは最大${MAX_PRICE_RANKS}段階です`}
            >
              <Plus className="h-4 w-4" aria-hidden />
              ランクを追加
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : priceRanks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            料金ランクが登録されていません。
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">ランク</th>
                  <th className="px-3 py-2 text-left font-medium">ラベル</th>
                  <th className="px-3 py-2 text-right font-medium">1名</th>
                  <th className="px-3 py-2 text-right font-medium">2名</th>
                  <th className="px-3 py-2 text-right font-medium">3名</th>
                  <th className="px-3 py-2 text-right font-medium">4名</th>
                  <th className="px-3 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {priceRanks.map((rank) => (
                  <tr key={rank.id} className="border-b hover:bg-muted/50">
                    <td className="px-3 py-2">R{String(rank.rank).padStart(2, "0")}</td>
                    <td className="px-3 py-2 font-medium">{rank.label}</td>
                    <td className="px-3 py-2 text-right">{formatYen(rank.price1P)}</td>
                    <td className="px-3 py-2 text-right">{formatYen(rank.price2P)}</td>
                    <td className="px-3 py-2 text-right">{formatYen(rank.price3P)}</td>
                    <td className="px-3 py-2 text-right">{formatYen(rank.price4P)}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canManage}
                          onClick={() => openEdit(rank)}
                          aria-label={`料金ランク ${rank.label} を編集`}
                        >
                          <Edit2 className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canManage || deletingId === rank.id}
                          onClick={() => setPendingDelete(rank)}
                          aria-label={`料金ランク ${rank.label} を削除`}
                        >
                          {deletingId === rank.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* 追加・編集ダイアログ */}
      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>
              {isCreate ? "料金ランク追加" : "料金ランク編集"}（R
              {String(dialogRankNumber ?? 0).padStart(2, "0")}）
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? `ランク番号は既存の最大値＋1で自動採番されます（最大${MAX_PRICE_RANKS}段階）`
                : "ラベルと人数別価格を編集します"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="rank-label">ラベル</Label>
                <Input
                  id="rank-label"
                  maxLength={10}
                  aria-invalid={errors.label ? true : undefined}
                  {...register("label")}
                />
                <FormFieldError message={errors.label?.message} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {PRICE_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={`rank-${field.key}`}>{field.label}</Label>
                    <Input
                      id={`rank-${field.key}`}
                      type="number"
                      min={0}
                      aria-invalid={errors[field.key] ? true : undefined}
                      placeholder={field.optional ? "未設定" : undefined}
                      {...register(
                        field.key,
                        field.optional
                          ? // 空欄は NaN ではなく null にして「未設定」を保存できるようにする（R-2）
                            { setValueAs: (v: string) => (v === "" ? null : Number(v)) }
                          : { valueAsNumber: true }
                      )}
                    />
                    <FormFieldError message={errors[field.key]?.message} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                人数別価格は 1名 ≤ 2名 ≤ 3名 ≤ 4名 になるように入力してください。
                3名・4名は空欄のままにすると「未設定」として保存されます。
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setTarget(null)}>
                キャンセル
              </Button>
              <Button type="submit" size="sm" className="gap-2" disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-4 w-4" aria-hidden />
                )}
                {isCreate ? "追加" : "保存"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 削除の確認（F-5） */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="料金ランクを削除しますか？"
        description={
          pendingDelete
            ? `R${String(pendingDelete.rank).padStart(2, "0")}「${pendingDelete.label}」を削除します。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="削除する"
        onConfirm={() => {
          const rank = pendingDelete
          setPendingDelete(null)
          if (rank) void handleDelete(rank)
        }}
      />
    </Card>
  )
}
