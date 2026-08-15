"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Download, FileText, Calendar, TrendingUp, Users, DollarSign } from "lucide-react"

export function ReportsTab() {
  const [reportType, setReportType] = useState("monthly")
  const [reportPeriod, setReportPeriod] = useState("2025-04")
  const [reportFormat, setReportFormat] = useState("pdf")

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-heading font-medium tracking-tight text-balance">レポート</h2>
        <p className="text-sm text-muted-foreground mt-0.5">各種レポートの生成とエクスポート</p>
      </div>

      {/* Report Generator */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="report-type" className="text-xs whitespace-nowrap">レポートタイプ</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger id="report-type" className="h-9 w-40 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">月次レポート</SelectItem>
                  <SelectItem value="quarterly">四半期レポート</SelectItem>
                  <SelectItem value="annual">年次レポート</SelectItem>
                  <SelectItem value="custom">カスタムレポート</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="report-period" className="text-xs whitespace-nowrap">対象期間</Label>
              <Select value={reportPeriod} onValueChange={setReportPeriod}>
                <SelectTrigger id="report-period" className="h-9 w-36 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2025-02">2025年2月</SelectItem>
                  <SelectItem value="2025-03">2025年3月</SelectItem>
                  <SelectItem value="2025-04">2025年4月</SelectItem>
                  <SelectItem value="2025-q1">2025年 Q1</SelectItem>
                  <SelectItem value="2025-ytd">2025年 年初来</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="report-format" className="text-xs whitespace-nowrap">出力形式</Label>
              <Select value={reportFormat} onValueChange={setReportFormat}>
                <SelectTrigger id="report-format" className="h-9 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="excel">Excel</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 ml-auto">
              <Button size="sm">
                <Download className="w-4 h-4 mr-2" />
                レポート生成
              </Button>
              <Button variant="outline" size="sm">
                プレビュー
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Reports */}
      <div>
        <h3 className="text-base font-semibold mb-2">クイックレポート</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-semibold">サマリー</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">月次の概要</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs flex-shrink-0">月次</Badge>
              </div>
              <Button variant="outline" size="sm" className="w-full h-8 text-xs">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                ダウンロード
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-[color:var(--chart-2)]/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-[color:var(--chart-2)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-semibold">日別パフォーマンス</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">詳細な日次データ</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs flex-shrink-0">日次</Badge>
              </div>
              <Button variant="outline" size="sm" className="w-full h-8 text-xs">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                ダウンロード
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-[color:var(--chart-3)]/10 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-[color:var(--chart-3)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-semibold">チャネル分析</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">予約チャネル別データ</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs flex-shrink-0">月次</Badge>
              </div>
              <Button variant="outline" size="sm" className="w-full h-8 text-xs">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                ダウンロード
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-[color:var(--chart-4)]/10 flex items-center justify-center flex-shrink-0">
                    <DollarSign className="w-4 h-4 text-[color:var(--chart-4)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-semibold">価格最適化レポート</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">価格戦略の効果分析</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs flex-shrink-0">週次</Badge>
              </div>
              <Button variant="outline" size="sm" className="w-full h-8 text-xs">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                ダウンロード
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Reports */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">最近のレポート</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {[
              {
                name: "2025年3月 月次レポート",
                type: "月次レポート",
                date: "2025-04-02",
                format: "PDF",
                size: "2.4 MB",
              },
              {
                name: "2025年Q1 四半期レポート",
                type: "四半期レポート",
                date: "2025-04-01",
                format: "Excel",
                size: "5.8 MB",
              },
              {
                name: "チャネル分析 2025年3月",
                type: "カスタムレポート",
                date: "2025-03-28",
                format: "PDF",
                size: "1.8 MB",
              },
              {
                name: "日別パフォーマンス 2025年3月",
                type: "日次レポート",
                date: "2025-03-25",
                format: "CSV",
                size: "0.5 MB",
              },
              {
                name: "2025年2月 月次レポート",
                type: "月次レポート",
                date: "2025-03-02",
                format: "PDF",
                size: "2.3 MB",
              },
            ].map((report, index) => (
              <div
                key={index}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 border border-border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{report.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{report.type}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">{report.date}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">{report.size}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                  <Badge variant="outline" className="text-xs">{report.format}</Badge>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Scheduled Reports */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">定期レポート設定</CardTitle>
            <Button variant="outline" size="sm" className="h-8">
              新規追加
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {[
              {
                name: "月次収益レポート",
                frequency: "毎月1日",
                recipients: "management@hotel.com",
                format: "PDF",
                status: "有効",
              },
              {
                name: "週次パフォーマンスサマリー",
                frequency: "毎週月曜日",
                recipients: "revenue@hotel.com",
                format: "Excel",
                status: "有効",
              },
              {
                name: "四半期分析レポート",
                frequency: "四半期末",
                recipients: "executives@hotel.com",
                format: "PDF",
                status: "有効",
              },
            ].map((schedule, index) => (
              <div
                key={index}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 border border-border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{schedule.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">{schedule.frequency}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">{schedule.recipients}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">{schedule.format}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                  <Badge variant="secondary" className="text-xs">{schedule.status}</Badge>
                  <Button variant="ghost" size="sm" className="h-8">
                    編集
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Report Templates */}
      <Card className="border-l-4 border-l-primary">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">レポートテンプレート</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <p className="text-sm text-muted-foreground">
            カスタムレポートテンプレートを作成して、必要なデータを自動的に集計・出力できます。
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="h-8">
              テンプレート管理
            </Button>
            <Button variant="outline" size="sm" className="h-8">
              新規テンプレート作成
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
