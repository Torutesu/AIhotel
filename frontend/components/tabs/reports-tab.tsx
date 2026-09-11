"use client"

// レポートタブ（U-4 / F-REP-01・F-REP-02）
// GET /api/v1/reports/monthly?format=pdf|excel を呼び、返ってきたバイナリを
// ブラウザのダウンロードとして保存する。架空の「最近のレポート」「定期レポート設定」
// 「クイックレポート」は実体が無いため撤去した。

import { useState } from "react"
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError } from "@/lib/api"
import { monthLabel } from "@/lib/date"

type ReportFormat = "pdf" | "excel"

/**
 * レポート種別。月次のみバックエンド（reportsService）が実装済みで、
 * それ以外は器も無いため「準備中」として選択できないようにする。
 */
const REPORT_TYPES = [
  { value: "monthly", label: "月次レポート", available: true },
  { value: "quarterly", label: "四半期レポート", available: false },
  { value: "annual", label: "年次レポート", available: false },
  { value: "custom", label: "カスタムレポート", available: false },
] as const

const REPORT_FORMATS: Array<{ value: ReportFormat; label: string; extension: string }> = [
  { value: "pdf", label: "PDF", extension: "pdf" },
  { value: "excel", label: "Excel", extension: "xlsx" },
]

/** Blob をブラウザのダウンロードとして保存する */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function ReportsTab() {
  const { hotelId, hotel } = useAuth()
  const now = new Date()

  const [reportType, setReportType] = useState<string>("monthly")
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [reportFormat, setReportFormat] = useState<ReportFormat>("pdf")
  const [downloading, setDownloading] = useState(false)

  const selectedType = REPORT_TYPES.find((t) => t.value === reportType) ?? REPORT_TYPES[0]
  const canDownload = hotelId != null && selectedType.available

  const handleDownload = async () => {
    if (!hotelId || !selectedType.available) return
    setDownloading(true)
    try {
      const { blob, filename } = await api.monthlyReport(hotelId, year, month, reportFormat)
      const extension =
        REPORT_FORMATS.find((f) => f.value === reportFormat)?.extension ?? reportFormat
      const fallbackName = `月次レポート_${hotel?.name ?? "hotel"}_${year}-${String(month).padStart(2, "0")}.${extension}`
      saveBlob(blob, filename ?? fallbackName)
      toast.success("レポートをダウンロードしました", {
        description: `${monthLabel(year, month)}の月次レポート（${reportFormat === "pdf" ? "PDF" : "Excel"}）`,
      })
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "レポートのダウンロードに失敗しました",
      )
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-heading font-medium tracking-tight text-balance">レポート</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          対象月の実績・予算・日別明細をPDFまたはExcelで出力します
        </p>
      </div>

      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="report-type" className="text-xs whitespace-nowrap">
                レポートタイプ
              </Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger id="report-type" className="h-9 w-44 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value} disabled={!type.available}>
                      {type.label}
                      {!type.available && "（準備中）"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="report-year" className="text-xs whitespace-nowrap">
                対象年
              </Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger id="report-year" className="h-9 w-24 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}年
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="report-month" className="text-xs whitespace-nowrap">
                対象月
              </Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger id="report-month" className="h-9 w-20 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m}月
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="report-format" className="text-xs whitespace-nowrap">
                出力形式
              </Label>
              <Select
                value={reportFormat}
                onValueChange={(value: ReportFormat) => setReportFormat(value)}
              >
                <SelectTrigger id="report-format" className="h-9 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto">
              <Button size="sm" onClick={handleDownload} disabled={!canDownload || downloading}>
                {downloading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
                ) : (
                  <Download className="w-4 h-4 mr-2" aria-hidden />
                )}
                レポートをダウンロード
              </Button>
            </div>
          </div>

          {!selectedType.available && (
            <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
              {selectedType.label}は準備中です。現在出力できるのは月次レポートのみです。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 出力内容の説明（実装済みの範囲のみを記載する） */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">月次レポートの内容</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              PDF
            </Badge>
            <Badge variant="outline" className="gap-1.5 text-xs">
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
              Excel
            </Badge>
            <span className="text-xs text-muted-foreground">
              {monthLabel(year, month)}・{hotel?.name ?? "所属ホテル"}
            </span>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>月間サマリー（室料売上・販売室数・ADR・稼働率・REV-Per・宿泊人数）</li>
            <li>月次予算および前年実績との比較</li>
            <li>日別明細（稼働率・ADR・室料売上・週末区分）</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
