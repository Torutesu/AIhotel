"use client"

// 初期設定を速くする仕組み（#13）
// - 初期設定シート（Excel）: 現在の設定を埋めたシートを出力し、埋めて取り込む（1ホテル分をまとめて投入）
// - 既存ホテルからの複製: 同じテナントの系列ホテルから部屋タイプ・料金ランク・価格戦略を複製（テナント全体の管理者のみ）
// - 連携先の記録: PMS・サイトコントローラーの製品と進み具合（接続そのものは #6）

import { useRef, useState } from "react"
import { Copy, Download, FileSpreadsheet, Loader2, Plug, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import {
  api,
  ApiClientError,
  type CopyableSettingsItem,
  type HotelIntegration,
  type IntegrationKind,
  type IntegrationStatus,
  type SetupWorkbookResult,
} from "@/lib/api"
import { canManage, ROLE_LABELS } from "@shared/types"

const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"

/** 2026-08-01 クライアントMTGで挙がった製品（#6）。候補外は「その他」で自由入力 */
export const INTEGRATION_PRODUCTS: Record<IntegrationKind, string[]> = {
  PMS: ["NEHOPS", "TAPホテルシステム", "OPERA", "アルメックス"],
  SITE_CONTROLLER: ["TLリンカーン", "手間いらず", "ねっぱん"],
}

const KIND_LABELS: Record<IntegrationKind, string> = { PMS: "PMS", SITE_CONTROLLER: "サイトコントローラー" }
const STATUS_LABELS: Record<IntegrationStatus, string> = { PLANNED: "予定", TESTING: "接続試験中", ACTIVE: "運用中" }
const COPY_ITEM_LABELS: Record<CopyableSettingsItem, string> = {
  roomTypes: "部屋タイプ",
  priceRanks: "料金ランク",
  strategy: "価格戦略（重みと推奨の調整）",
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? "").replace(/^data:[^,]*,/, ""))
    reader.onerror = () => reject(reader.error ?? new Error("ファイルを読み込めませんでした"))
    reader.readAsDataURL(file)
  })
}

export function HotelSetupToolsSection() {
  const { user } = useAuth()
  const editable = canManage(user?.role)
  // 複製は複製元にもアクセスできる、テナント全体を見る管理者（と運営）だけが使える
  const canCopy = (user?.role === "ADMIN" && !user.hotelId) || user?.role === "PLATFORM_ADMIN"

  return (
    <Card>
      <CardHeader>
        <CardTitle>初期設定の一括投入と連携先</CardTitle>
        <CardDescription>
          新しいホテルの設定をまとめて入れるための機能です。
          {!editable && `（変更には${ROLE_LABELS.MANAGER}以上の権限が必要です）`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {editable && <SetupWorkbookPanel />}
        {canCopy && <CopySettingsPanel />}
        <IntegrationsPanel editable={editable} />
      </CardContent>
    </Card>
  )
}

function SetupWorkbookPanel() {
  const { hotelId } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ fileName: string; base64: string; result: SetupWorkbookResult } | null>(null)
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([])

  const reset = () => {
    setPending(null)
    setErrors([])
    if (inputRef.current) inputRef.current.value = ""
  }

  const handleDownload = async () => {
    if (!hotelId) return
    setBusy(true)
    try {
      const { blob } = await api.downloadSetupWorkbook(hotelId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "初期設定シート.xlsx"
      // 文書に追加してからクリックしないと、ブラウザによってはファイル名が付かない
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "シートを出力できませんでした")
    } finally {
      setBusy(false)
    }
  }

  const handleFile = async (file: File) => {
    if (!hotelId) return
    reset()
    setBusy(true)
    try {
      const base64 = await readFileAsBase64(file)
      const result = await api.importSetupWorkbook(hotelId, base64, true)
      setPending({ fileName: file.name, base64, result })
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.length > 0) setErrors(err.fieldErrors)
      else toast.error(err instanceof ApiClientError ? err.message : "シートの確認に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async () => {
    if (!hotelId || !pending) return
    setBusy(true)
    try {
      await api.importSetupWorkbook(hotelId, pending.base64, false)
      toast.success("初期設定シートを取り込みました", { description: "設定タブの各項目を開き直すと反映されています" })
      reset()
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.length > 0) {
        setPending(null)
        setErrors(err.fieldErrors)
      } else {
        toast.error(err instanceof ApiClientError ? err.message : "取り込みに失敗しました")
      }
    } finally {
      setBusy(false)
    }
  }

  const summary = (c: { created: number; updated: number }) => `新規 ${c.created}・更新 ${c.updated}`

  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <FileSpreadsheet className="h-4 w-4" aria-hidden />
        初期設定シート（Excel）
      </h4>
      <p className="text-xs text-muted-foreground">
        基本情報・部屋タイプ・料金ランク・競合・予算を1つのシートでまとめて入れられます。出力したシートには現在の設定が入っています。
        行を消しても設定は消えません（削除は各設定から行います）。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => void handleDownload()}>
          <Download className="h-4 w-4" aria-hidden />
          シートを出力
        </Button>
        <Button variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          シートを取り込む
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          aria-label="初期設定シートのファイル"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">取り込めない箇所があります（何も取り込んでいません）</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
            {errors.slice(0, 50).map((e, i) => (
              <li key={i}>
                {e.field.replace("!", " の ")}
                {/^\d+$/.test(e.field.split("!")[1] ?? "") ? "行目" : ""}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending && (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p>
            <span className="font-medium">{pending.fileName}</span> の内容
          </p>
          <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
            <li>基本情報：{pending.result.basicUpdated ? "シートの値に揃える" : "変更なし"}</li>
            <li>部屋タイプ：{summary(pending.result.roomTypes)}</li>
            <li>料金ランク：{summary(pending.result.priceRanks)}</li>
            <li>競合：{summary(pending.result.competitors)}</li>
            <li>予算：{summary(pending.result.budgets)}</li>
          </ul>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void handleImport()}>
              取り込む
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={reset}>
              やめる
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function CopySettingsPanel() {
  const { hotelId, hotels } = useAuth()
  // 運営には全テナントのホテルが見えるので、同じテナントのホテルだけを候補にする
  const tenantId = hotels.find((h) => h.id === hotelId)?.tenantId
  const sources = hotels.filter((h) => h.id !== hotelId && h.tenantId === tenantId)
  const [sourceHotelId, setSourceHotelId] = useState("")
  const [items, setItems] = useState<CopyableSettingsItem[]>(["roomTypes", "priceRanks", "strategy"])
  const [busy, setBusy] = useState(false)

  if (sources.length === 0) return null

  const toggle = (item: CopyableSettingsItem, checked: boolean) =>
    setItems((prev) => (checked ? [...prev, item] : prev.filter((i) => i !== item)))

  const handleCopy = async () => {
    if (!hotelId || !sourceHotelId || items.length === 0) return
    setBusy(true)
    try {
      const { copied } = await api.copyHotelSettings(hotelId, sourceHotelId, items)
      const detail = (Object.keys(copied) as CopyableSettingsItem[]).map((k) => `${COPY_ITEM_LABELS[k]} ${copied[k]}件`).join("、")
      toast.success("設定を複製しました", { description: `${detail}。部屋タイプの室数はこのホテルに合わせて直してください` })
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "設定の複製に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 border-t pt-4">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <Copy className="h-4 w-4" aria-hidden />
        既存ホテルから設定を複製
      </h4>
      <p className="text-xs text-muted-foreground">
        系列ホテルの設定を、このホテルに複製します。このホテルに既に登録済みの項目は上書きしません。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="copy-source" className="text-xs">複製元のホテル</Label>
          <select id="copy-source" className={SELECT_CLASS} value={sourceHotelId} disabled={busy} onChange={(e) => setSourceHotelId(e.target.value)}>
            <option value="">選択してください</option>
            {sources.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-xs">複製する項目</legend>
          {(Object.keys(COPY_ITEM_LABELS) as CopyableSettingsItem[]).map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={items.includes(item)} disabled={busy} onChange={(e) => toggle(item, e.target.checked)} />
              {COPY_ITEM_LABELS[item]}
            </label>
          ))}
        </fieldset>
      </div>
      <Button size="sm" disabled={busy || !sourceHotelId || items.length === 0} onClick={() => void handleCopy()}>
        複製する
      </Button>
    </section>
  )
}

function IntegrationsPanel({ editable }: { editable: boolean }) {
  const { hotelId } = useAuth()
  const { data, loading, error, reload, setData } = useApiQuery<HotelIntegration[]>(
    hotelId ? () => api.integrations(hotelId) : null,
    [hotelId],
    "連携先の取得に失敗しました",
  )

  return (
    <section className="space-y-3 border-t pt-4">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <Plug className="h-4 w-4" aria-hidden />
        連携先（PMS・サイトコントローラー）
      </h4>
      <p className="text-xs text-muted-foreground">
        製品と接続の進み具合を記録します。データの自動連携は接続の準備ができてから始まります。
      </p>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(["PMS", "SITE_CONTROLLER"] as const).map((kind) => (
            <IntegrationForm
              key={`${kind}-${data?.find((i) => i.kind === kind)?.updatedAt ?? "none"}`}
              kind={kind}
              current={data?.find((i) => i.kind === kind) ?? null}
              editable={editable}
              onSaved={(saved) => setData([...(data ?? []).filter((i) => i.kind !== kind), saved])}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function IntegrationForm({
  kind,
  current,
  editable,
  onSaved,
}: {
  kind: IntegrationKind
  current: HotelIntegration | null
  editable: boolean
  onSaved: (saved: HotelIntegration) => void
}) {
  const { hotelId } = useAuth()
  const candidates = INTEGRATION_PRODUCTS[kind]
  const toState = (i: HotelIntegration | null) => ({
    choice: !i ? "" : candidates.includes(i.product) ? i.product : "__other",
    other: i && !candidates.includes(i.product) ? i.product : "",
    connectionMethod: i?.connectionMethod ?? "",
    status: (i?.status ?? "PLANNED") as IntegrationStatus,
  })
  // 保存済みの値が変わったときは、親が key を変えてこのフォームを作り直す
  const [form, setForm] = useState(() => toState(current))
  const [saving, setSaving] = useState(false)

  const product = form.choice === "__other" ? form.other.trim() : form.choice
  const id = `integration-${kind}`

  const handleSave = async () => {
    if (!hotelId || !product) return
    setSaving(true)
    try {
      const saved = await api.saveIntegration({
        hotelId,
        kind,
        product,
        connectionMethod: form.connectionMethod.trim() || null,
        status: form.status,
        note: current?.note ?? null,
      })
      onSaved(saved)
      toast.success(`${KIND_LABELS[kind]}を保存しました`)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const disabled = !editable || saving
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="text-sm font-medium">{KIND_LABELS[kind]}</div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-product`} className="text-xs">製品</Label>
        <select id={`${id}-product`} className={SELECT_CLASS} value={form.choice} disabled={disabled} onChange={(e) => setForm({ ...form, choice: e.target.value })}>
          <option value="">未設定</option>
          {candidates.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="__other">その他</option>
        </select>
        {form.choice === "__other" && (
          <Input aria-label={`${KIND_LABELS[kind]}の製品名`} value={form.other} maxLength={100} disabled={disabled} onChange={(e) => setForm({ ...form, other: e.target.value })} />
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-method`} className="text-xs">連携方式</Label>
        <Input id={`${id}-method`} value={form.connectionMethod} maxLength={200} disabled={disabled} placeholder="例: Windows端末からCSVを送信" onChange={(e) => setForm({ ...form, connectionMethod: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-status`} className="text-xs">状態</Label>
        <select id={`${id}-status`} className={SELECT_CLASS} value={form.status} disabled={disabled} onChange={(e) => setForm({ ...form, status: e.target.value as IntegrationStatus })}>
          {(Object.keys(STATUS_LABELS) as IntegrationStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {editable && (
        <Button size="sm" disabled={saving || !product} onClick={() => void handleSave()}>
          保存
        </Button>
      )}
    </div>
  )
}
