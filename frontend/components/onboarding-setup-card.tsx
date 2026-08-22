"use client"

// 初期設定ウィザード（SAAS_ONBOARDING.md Step 4）。
// 必須5項目の完了チェックリスト＋料金ランク一括生成＋CSVインポートを設定タブに提供する。

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  Upload,
  Wand2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { api, ApiClientError, type OnboardingStatus, type CsvImportKind } from "@/lib/api"

const CSV_IMPORT_DEFS: Record<
  CsvImportKind,
  { label: string; header: string; description: string }
> = {
  "room-types": {
    label: "客室タイプ",
    header: "code,name,capacity,count,sortOrder",
    description: "code（大文字英数字）で既存タイプを上書き、新規コードは追加します。sortOrder は省略可。",
  },
  budgets: {
    label: "月次予算・前年実績",
    header:
      "year,month,budgetRevenue,budgetRooms,budgetAdr,budgetOccupancy,budgetGuests,lastYearRevenue,lastYearRooms,lastYearAdr,lastYearOccupancy,lastYearGuests",
    description: "year/month 単位で上書きします。稼働率は 0〜1（例 0.78）。金額系の列は省略可。",
  },
  "daily-data": {
    label: "過去日次実績（データ移行）",
    header: "date,occupancy,adr,revPar,totalRevenue,soldRooms,guests",
    description: "date（YYYY-MM-DD）単位で上書きします。稼働率は 0〜1。date 以外の列は省略可。",
  },
}

interface OnboardingSetupCardProps {
  hotelId: string
  canManage: boolean
  /** 料金ランクを変更した後に呼ぶ（設定タブのランク一覧を再読込する） */
  onPriceRanksChanged: () => void
}

export function OnboardingSetupCard({
  hotelId,
  canManage,
  onPriceRanksChanged,
}: OnboardingSetupCardProps) {
  const { toast } = useToast()

  // ---- 完了状況チェックリスト ----
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    if (!hotelId) return
    setStatusLoading(true)
    setStatusError(null)
    try {
      setStatus(await api.onboardingStatus(hotelId))
    } catch (err) {
      setStatusError(
        err instanceof ApiClientError ? err.message : "初期設定状況の取得に失敗しました"
      )
    } finally {
      setStatusLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // ---- 料金ランク一括生成 ----
  const [minPrice, setMinPrice] = useState(6500)
  const [maxPrice, setMaxPrice] = useState(30000)
  const [rankCount, setRankCount] = useState(40)
  const [multiplier2P, setMultiplier2P] = useState(1.4)
  const [multiplier3P, setMultiplier3P] = useState(1.8)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const ranks = await api.generatePriceRanks(hotelId, {
        count: rankCount,
        minPrice1P: minPrice,
        maxPrice1P: maxPrice,
        multiplier2P,
        multiplier3P,
        replaceExisting,
      })
      toast({
        title: `料金ランクを${ranks.length}段階生成しました`,
        description: "下の料金ランク設定から個別に調整できます。",
      })
      setReplaceExisting(false)
      onPriceRanksChanged()
      await loadStatus()
    } catch (err) {
      toast({
        title: "料金ランクの生成に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setGenerating(false)
    }
  }

  // ---- CSVインポート ----
  const [importKind, setImportKind] = useState<CsvImportKind>("room-types")
  const [csvText, setCsvText] = useState("")
  const [importing, setImporting] = useState(false)

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return
    setCsvText(await file.text())
  }

  const handleImport = async () => {
    if (!csvText.trim()) return
    setImporting(true)
    try {
      const result = await api.importCsv(importKind, hotelId, csvText)
      toast({
        title: `${CSV_IMPORT_DEFS[importKind].label}を${result.imported}件取り込みました`,
      })
      setCsvText("")
      if (importKind === "room-types") onPriceRanksChanged()
      await loadStatus()
    } catch (err) {
      // 行エラーは先頭数件をまとめて表示する（全件はAPIレスポンス参照）
      const detail =
        err instanceof ApiClientError
          ? [err.message, ...(err.errors ?? []).slice(0, 5).map((e) => `${e.field}: ${e.message}`)].join("\n")
          : undefined
      toast({
        title: "CSVの取り込みに失敗しました",
        description: detail,
        variant: "destructive",
      })
    } finally {
      setImporting(false)
    }
  }

  const importDef = CSV_IMPORT_DEFS[importKind]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>初期設定（オンボーディング）</CardTitle>
            <CardDescription>
              運用開始に必要な設定の完了状況です
              {!canManage && "（設定の投入にはMANAGER以上の権限が必要です）"}
            </CardDescription>
          </div>
          {status && (
            <Badge variant={status.isComplete ? "default" : "secondary"}>
              必須 {status.requiredCompleteCount}/{status.requiredTotalCount} 完了
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 完了状況チェックリスト */}
        {statusLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : statusError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{statusError}</p>
            <Button variant="outline" size="sm" onClick={loadStatus} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </div>
        ) : status ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">必須項目</p>
              {status.required.map((item) => (
                <div key={item.key} className="flex items-start gap-2 text-sm">
                  {item.complete ? (
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  )}
                  <div>
                    <span className={item.complete ? "" : "font-medium"}>{item.label}</span>
                    <span className="text-muted-foreground ml-2">{item.detail}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">任意項目（導入後1〜2週間で投入）</p>
              {status.optional.map((item) => (
                <div key={item.key} className="flex items-start gap-2 text-sm">
                  {item.complete ? (
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  )}
                  <div>
                    <span>{item.label}</span>
                    <span className="text-muted-foreground ml-2">{item.detail}</span>
                  </div>
                </div>
              ))}
              <div className="pt-1">
                <Button variant="ghost" size="sm" onClick={loadStatus} className="gap-2 text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5" />
                  状況を更新
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {canManage && (
          <>
            <Separator />

            {/* 料金ランク一括生成 */}
            <div className="space-y-3">
              <div>
                <p className="font-medium text-sm">料金ランク一括生成</p>
                <p className="text-sm text-muted-foreground">
                  1名利用の下限〜上限価格から最大40段階を自動生成します（100円単位・生成後に個別調整可能）
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="gen-min">下限価格（1名）</Label>
                  <Input
                    id="gen-min"
                    type="number"
                    value={minPrice}
                    onChange={(e) => setMinPrice(Number.parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gen-max">上限価格（1名）</Label>
                  <Input
                    id="gen-max"
                    type="number"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(Number.parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gen-count">段階数（最大40）</Label>
                  <Input
                    id="gen-count"
                    type="number"
                    min={1}
                    max={40}
                    value={rankCount}
                    onChange={(e) => setRankCount(Number.parseInt(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gen-m2">2名倍率</Label>
                  <Input
                    id="gen-m2"
                    type="number"
                    step="0.1"
                    value={multiplier2P}
                    onChange={(e) => setMultiplier2P(Number.parseFloat(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gen-m3">3名倍率</Label>
                  <Input
                    id="gen-m3"
                    type="number"
                    step="0.1"
                    value={multiplier3P}
                    onChange={(e) => setMultiplier3P(Number.parseFloat(e.target.value) || 1)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="gen-replace"
                    checked={replaceExisting}
                    onCheckedChange={(checked) => setReplaceExisting(checked === true)}
                  />
                  <Label htmlFor="gen-replace" className="font-normal text-sm">
                    既存の料金ランクを置き換える（チェックなしの場合、既存があればエラーになります）
                  </Label>
                </div>
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={generating || minPrice <= 0 || maxPrice < minPrice}
                  onClick={handleGenerate}
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  一括生成
                </Button>
              </div>
            </div>

            <Separator />

            {/* CSVインポート */}
            <div className="space-y-3">
              <div>
                <p className="font-medium text-sm">CSVインポート</p>
                <p className="text-sm text-muted-foreground">
                  ヒアリングシートからの一括投入用です。エラーが1件でもあると取り込みは行われません。
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="import-kind">取り込み対象</Label>
                  <Select value={importKind} onValueChange={(v) => setImportKind(v as CsvImportKind)}>
                    <SelectTrigger id="import-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CSV_IMPORT_DEFS) as CsvImportKind[]).map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {CSV_IMPORT_DEFS[kind].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="import-file">CSVファイル</Label>
                  <Input
                    id="import-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => handleFileSelected(e.target.files?.[0])}
                  />
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p>ヘッダー行: <code className="font-mono">{importDef.header}</code></p>
                <p>{importDef.description}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="import-csv">CSV内容（ファイル選択または貼り付け）</Label>
                <Textarea
                  id="import-csv"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={importDef.header}
                  rows={6}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={importing || !csvText.trim()}
                  onClick={handleImport}
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  取り込み実行
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
