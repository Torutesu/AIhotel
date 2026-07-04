"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"
import { CalendarIcon, Save } from "lucide-react"
import { toast } from "sonner"
import type { AnalysisSettings, DisplayMode, GraphType, SegmentCrossAnalysisSettings } from "@shared/types"

interface SegmentCrossAnalysisSettingsProps {
  onSave?: (settings: SegmentCrossAnalysisSettings) => void
}

export function SegmentCrossAnalysisSettings({ onSave }: SegmentCrossAnalysisSettingsProps) {
  const [dateFrom, setDateFrom] = useState<Date | undefined>(new Date())
  const [dateTo, setDateTo] = useState<Date | undefined>(new Date())
  const [displayMode, setDisplayMode] = useState<DisplayMode>("table")
  const [graphType, setGraphType] = useState<GraphType>("total")
  const [includeBatch, setIncludeBatch] = useState(false)

  const [channelAnalysis, setChannelAnalysis] = useState<AnalysisSettings>({
    key: "チャネル",
    selection: "全体",
    showRooms: true,
    showGuests: true,
    showADR: true,
    showReservations: true,
    individualGroupTotal: "total",
    includeRoomType: false,
  })

  const [regionAnalysis, setRegionAnalysis] = useState<AnalysisSettings>({
    key: "地域",
    selection: "全体",
    showRooms: true,
    showGuests: true,
    showADR: true,
    showReservations: true,
    individualGroupTotal: "total",
  })

  const [groupAnalysis, setGroupAnalysis] = useState<AnalysisSettings>({
    key: "個人・団体",
    selection: "全体",
    showRooms: true,
    showGuests: true,
    showADR: true,
    showReservations: true,
    individualGroupTotal: "total",
  })

  const [cancelAnalysis, setCancelAnalysis] = useState<AnalysisSettings>({
    key: "キャンセル予約フラグ",
    selection: "全体",
    showRooms: true,
    showGuests: true,
    showADR: true,
    showReservations: true,
    individualGroupTotal: "total",
  })

  const [otherAnalysis, setOtherAnalysis] = useState<AnalysisSettings>({
    key: "その他",
    selection: "全体",
    showRooms: true,
    showGuests: true,
    showADR: true,
    showReservations: true,
    individualGroupTotal: "total",
  })

  const [reservationTypeView, setReservationTypeView] = useState<"reservation" | "group">("reservation")
  const [typeGroupingData, setTypeGroupingData] = useState([
    { actualType: "Bタイプ", groupResult: "シングル47室 → ダブル25室、ツイン18室、トリプル3室、その他1室" },
    { actualType: "Cタイプ", groupResult: "ダブル30室 → ダブル28室、その他2室" },
    { actualType: "Dタイプ", groupResult: "ツイン20室 → ツイン18室、ダブル2室" },
    { actualType: "Eタイプ", groupResult: "トリプル10室 → トリプル8室、ツイン2室" },
    { actualType: "Fタイプ", groupResult: "シングル15室" },
    { actualType: "Gタイプ", groupResult: "その他5室" },
  ])

  const handleSave = () => {
    // バリデーション
    if (!dateFrom || !dateTo) {
      toast.error("期間を設定してください", {
        description: "FROMとTOの日付を選択してください。",
      })
      return
    }

    if (dateFrom > dateTo) {
      toast.error("期間の設定が不正です", {
        description: "FROMの日付はTOの日付より前である必要があります。",
      })
      return
    }

    const settings: SegmentCrossAnalysisSettings = {
      dateFrom,
      dateTo,
      displayMode,
      graphType,
      channelAnalysis,
      regionAnalysis,
      groupAnalysis,
      cancelAnalysis,
      otherAnalysis,
      reservationTypeView,
      includeBatch,
    }

    // 保存処理のシミュレーション（非同期）
    const savePromise = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          onSave?.(settings)
          resolve()
        } catch (error) {
          reject(error)
        }
      }, 500)
    })

    toast.promise(savePromise, {
      loading: "設定を保存中...",
      success: includeBatch
        ? "基本分析に設定しました。バッチ処理に登録されました。"
        : "基本分析に設定しました。",
      error: "保存に失敗しました。もう一度お試しください。",
    })
  }

  const AnalysisSection = ({
    title,
    settings,
    onChange,
    showRoomTypeToggle = false,
  }: {
    title: string
    settings: AnalysisSettings
    onChange: (settings: AnalysisSettings) => void
    showRoomTypeToggle?: boolean
  }) => {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="font-semibold w-24">KEY</Label>
            <Input value={settings.key} readOnly className="flex-1" />
          </div>

          <div className="flex items-center gap-4">
            <Label className="font-semibold w-24">選択肢</Label>
            <Select value={settings.selection} onValueChange={(value) => onChange({ ...settings, selection: value })}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="全体">全体</SelectItem>
                <SelectItem value="主要チャネルまで">主要チャネルまで</SelectItem>
                <SelectItem value="カスタム選択">カスタム選択</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">表示項目</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${title}-rooms`}
                  checked={settings.showRooms}
                  onCheckedChange={(checked) => onChange({ ...settings, showRooms: checked as boolean })}
                />
                <Label htmlFor={`${title}-rooms`} className="font-normal">室数(横軸)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${title}-guests`}
                  checked={settings.showGuests}
                  onCheckedChange={(checked) => onChange({ ...settings, showGuests: checked as boolean })}
                />
                <Label htmlFor={`${title}-guests`} className="font-normal">利用人数(縦軸)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${title}-adr`}
                  checked={settings.showADR}
                  onCheckedChange={(checked) => onChange({ ...settings, showADR: checked as boolean })}
                />
                <Label htmlFor={`${title}-adr`} className="font-normal">ADR</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${title}-reservations`}
                  checked={settings.showReservations}
                  onCheckedChange={(checked) => onChange({ ...settings, showReservations: checked as boolean })}
                />
                <Label htmlFor={`${title}-reservations`} className="font-normal">予約件数</Label>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Label className="font-semibold w-24">個人・団体・TOTAL</Label>
            <RadioGroup
              value={settings.individualGroupTotal}
              onValueChange={(value: "individual" | "group" | "total") =>
                onChange({ ...settings, individualGroupTotal: value })
              }
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="individual" id={`${title}-individual`} />
                <Label htmlFor={`${title}-individual`} className="font-normal">個人</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="group" id={`${title}-group`} />
                <Label htmlFor={`${title}-group`} className="font-normal">団体</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="total" id={`${title}-total`} />
                <Label htmlFor={`${title}-total`} className="font-normal">TOTAL</Label>
              </div>
            </RadioGroup>
          </div>

          {showRoomTypeToggle && (
            <div className="flex items-center gap-4">
              <Label className="font-semibold w-24">部屋タイプを加える</Label>
              <Switch
                checked={settings.includeRoomType}
                onCheckedChange={(checked) => onChange({ ...settings, includeRoomType: checked })}
              />
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      {/* ページタイトル */}
      <div>
        <h2 className="text-3xl font-semibold">セグメント別クロス分析</h2>
        <p className="text-muted-foreground mt-2">各種分析タイプの設定を行います</p>
      </div>

      {/* 期間設定 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">期間設定</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="font-semibold">FROM</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[240px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "yyyy年MM月dd日", { locale: ja }) : "日付を選択"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus locale={ja} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-2">
              <Label className="font-semibold">TO</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[240px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "yyyy年MM月dd日", { locale: ja }) : "日付を選択"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus locale={ja} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 表・グラフ切替 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">表示方法</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="font-semibold">表示モード</Label>
            <RadioGroup
              value={displayMode}
              onValueChange={(value: DisplayMode) => setDisplayMode(value)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="table" id="display-table" />
                <Label htmlFor="display-table" className="font-normal">表で見る</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="graph" id="display-graph" />
                <Label htmlFor="display-graph" className="font-normal">グラフで見る</Label>
              </div>
            </RadioGroup>
          </div>

          {displayMode === "graph" && (
            <div className="flex items-center gap-4">
              <Label className="font-semibold">グラフ種類</Label>
              <RadioGroup
                value={graphType}
                onValueChange={(value: GraphType) => setGraphType(value)}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="total" id="graph-total" />
                  <Label htmlFor="graph-total" className="font-normal">期間の合計（線グラフ）</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="daily" id="graph-daily" />
                  <Label htmlFor="graph-daily" className="font-normal">日別の積み上げ折れ線（プッシングカーブ）</Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分析タイプセクション */}
      <AnalysisSection
        title="チャネル分析"
        settings={channelAnalysis}
        onChange={setChannelAnalysis}
        showRoomTypeToggle={true}
      />

      <AnalysisSection title="地域別分析" settings={regionAnalysis} onChange={setRegionAnalysis} />

      <AnalysisSection title="個人・団体分析" settings={groupAnalysis} onChange={setGroupAnalysis} />

      <AnalysisSection title="キャンセル分析" settings={cancelAnalysis} onChange={setCancelAnalysis} />

      <AnalysisSection title="その他" settings={otherAnalysis} onChange={setOtherAnalysis} />

      {/* タイプ組合せ分析 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">タイプ組合せ分析</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="font-semibold">表示方法</Label>
            <RadioGroup
              value={reservationTypeView}
              onValueChange={(value: "reservation" | "group") => setReservationTypeView(value)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="reservation" id="type-reservation" />
                <Label htmlFor="type-reservation" className="font-normal">予約タイプ別</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="group" id="type-group" />
                <Label htmlFor="type-group" className="font-normal">タイプグループ別</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">タイプ別予約タイプ</Label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold">実タイプ</th>
                    <th className="text-left py-3 px-4 font-semibold">タイプグループ化</th>
                  </tr>
                </thead>
                <tbody>
                  {typeGroupingData.map((row, index) => (
                    <tr key={index} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{row.actualType}</td>
                      <td className="py-3 px-4">{row.groupResult}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 基本分析に設定するボタン */}
      <div className="sticky bottom-0 bg-background border-t p-4 shadow-lg">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="include-batch"
                  checked={includeBatch}
                  onCheckedChange={(checked) => setIncludeBatch(checked as boolean)}
                />
                <Label htmlFor="include-batch" className="font-normal">バッチ処理対象にする</Label>
              </div>
              <Button onClick={handleSave} size="lg" className="gap-2">
                <Save className="w-4 h-4" />
                基本分析に設定する
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

