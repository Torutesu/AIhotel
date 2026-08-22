"use client"

// Excelデータ取込カード（設定タブ）
// ランク表・日次実績のExcelを手動アップロードしてシステムへ反映する。
// PMS/OTA連携（Phase 4）までの主要なデータ反映経路。

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, Download, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { api, ApiClientError, type ImportJob, type ImportResult, type ImportType } from "@/lib/api"

const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  price_ranks: "料金ランク表",
  daily_actual: "日次実績",
}

/** File を base64 文字列へ変換する（スタック溢れを避けるためチャンク処理） */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function ExcelImportCard({ hotelId, canManage }: { hotelId: string | null; canManage: boolean }) {
  const { toast } = useToast()

  const [importType, setImportType] = useState<ImportType>("daily_actual")
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [lastResult, setLastResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)

  const loadJobs = useCallback(async () => {
    if (!hotelId) return
    setJobsLoading(true)
    setJobsError(null)
    try {
      setJobs(await api.importJobs(hotelId))
    } catch (err) {
      setJobsError(err instanceof ApiClientError ? err.message : "取込履歴の取得に失敗しました")
    } finally {
      setJobsLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  const handleDownloadTemplate = async () => {
    if (!hotelId) return
    setDownloading(true)
    try {
      await api.downloadImportTemplate(hotelId, importType)
    } catch (err) {
      toast({
        variant: "destructive",
        title: "テンプレートのダウンロードに失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
      })
    } finally {
      setDownloading(false)
    }
  }

  const handleUpload = async () => {
    if (!hotelId || !file) return
    setUploading(true)
    setLastResult(null)
    try {
      const fileBase64 = await fileToBase64(file)
      const result = await api.createImport({
        hotelId,
        type: importType,
        fileName: file.name,
        fileBase64,
      })
      setLastResult(result)
      if (result.status === "completed") {
        toast({
          title: "取込が完了しました",
          description: `${result.createdCount + result.updatedCount}件を反映しました（新規${result.createdCount}・更新${result.updatedCount}）${result.forecastRecomputed ? "。AI予測も再計算済みです" : ""}`,
        })
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ""
      } else {
        toast({
          variant: "destructive",
          title: `取込エラーが${result.errorCount}件あります`,
          description: "エラー内容を確認し、修正して再アップロードしてください",
        })
      }
      loadJobs()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "取込に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5" />
          Excelデータ取込
        </CardTitle>
        <CardDescription>
          料金ランク表・日次実績をExcelでアップロードしてシステムへ反映します。取込後はAI予測が自動で再計算されます
          {!canManage && "（取込にはMANAGER以上の権限が必要です）"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <Label>取込データ種別</Label>
            <Select value={importType} onValueChange={(v: ImportType) => setImportType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily_actual">日次実績（稼働・ADR・売上）</SelectItem>
                <SelectItem value="price_ranks">料金ランク表（最大40段階）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-file">Excelファイル（.xlsx）</Label>
            <Input
              id="import-file"
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              disabled={!canManage}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2 bg-transparent"
              onClick={handleDownloadTemplate}
              disabled={downloading || !hotelId}
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              テンプレート
            </Button>
            <Button
              className="gap-2"
              onClick={handleUpload}
              disabled={!canManage || !file || uploading || !hotelId}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              アップロード
            </Button>
          </div>
        </div>

        {lastResult && lastResult.status === "failed" && (
          <div className="border border-destructive/50 rounded-md p-3 space-y-2">
            <p className="text-sm font-medium text-destructive flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              取込エラー（{lastResult.errorCount}件） — データは反映されていません
            </p>
            <div className="max-h-40 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {lastResult.errors.map((e, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-3 whitespace-nowrap text-muted-foreground">{e.row}行目</td>
                      <td className="py-1">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>取込履歴</Label>
            <Button variant="ghost" size="sm" onClick={loadJobs} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              更新
            </Button>
          </div>
          {jobsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : jobsError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{jobsError}</p>
              <Button variant="outline" size="sm" onClick={loadJobs} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">取込履歴はまだありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">日時</th>
                    <th className="text-left py-2 px-3 font-medium">種別</th>
                    <th className="text-left py-2 px-3 font-medium">ファイル</th>
                    <th className="text-center py-2 px-3 font-medium">結果</th>
                    <th className="text-right py-2 px-3 font-medium">新規/更新/エラー</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3 whitespace-nowrap">
                        {new Date(job.createdAt).toLocaleString("ja-JP")}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">{IMPORT_TYPE_LABELS[job.type] ?? job.type}</td>
                      <td className="py-2 px-3 max-w-[220px] truncate" title={job.fileName}>
                        {job.fileName}
                      </td>
                      <td className="text-center py-2 px-3">
                        {job.status === "completed" ? (
                          <span className="text-emerald-600 dark:text-emerald-400">完了</span>
                        ) : (
                          <span className="text-destructive">エラー</span>
                        )}
                      </td>
                      <td className="text-right py-2 px-3 whitespace-nowrap">
                        {job.createdCount} / {job.updatedCount} / {job.errorCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
