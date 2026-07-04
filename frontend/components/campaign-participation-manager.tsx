"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"
import { CalendarIcon, Plus, Trash2, Download, Upload, Save } from "lucide-react"
import { toast } from "sonner"
import type { CampaignData } from "@shared/types"

export function CampaignParticipationManager() {
  const [campaigns, setCampaigns] = useState<CampaignData[]>([
    {
      id: "1",
      campaignName: "楽天トラベル ビジネスキャンペーン",
      channel: "楽天トラベル",
      startDate: new Date(2025, 8, 25),
      endDate: new Date(2025, 9, 5),
      source: "ota",
      rooms: 150,
      adrImpact: 103,
      revParImpact: 118,
      description: "9/25～10/5のビジネスキャンペーン参画",
    },
  ])

  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Omit<CampaignData, "id">>({
    campaignName: "",
    channel: "",
    startDate: null,
    endDate: null,
    source: "manual",
    rooms: 0,
    adrImpact: 0,
    revParImpact: 0,
    description: "",
  })

  const channels = ["楽天トラベル", "じゃらん", "一休.com", "Booking.com", "Expedia", "Agoda", "その他リアルエージェント"]

  const handleAdd = () => {
    setIsAdding(true)
    setFormData({
      campaignName: "",
      channel: "",
      startDate: null,
      endDate: null,
      source: "manual",
      rooms: 0,
      adrImpact: 0,
      revParImpact: 0,
      description: "",
    })
  }

  const handleEdit = (campaign: CampaignData) => {
    setEditingId(campaign.id)
    setFormData({
      campaignName: campaign.campaignName,
      channel: campaign.channel,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      source: campaign.source,
      rooms: campaign.rooms,
      adrImpact: campaign.adrImpact,
      revParImpact: campaign.revParImpact,
      description: campaign.description,
    })
  }

  const handleSave = () => {
    if (!formData.campaignName || !formData.channel || !formData.startDate || !formData.endDate) {
      toast.error("必須項目を入力してください", {
        description: "キャンペーン名、チャンネル、開始日、終了日は必須です。",
      })
      return
    }

    if (isAdding) {
      const newCampaign: CampaignData = {
        id: Date.now().toString(),
        ...formData,
      }
      setCampaigns([...campaigns, newCampaign])
      toast.success("キャンペーンを追加しました")
    } else if (editingId) {
      setCampaigns(
        campaigns.map((c) => (c.id === editingId ? { id: editingId, ...formData } : c))
      )
      toast.success("キャンペーンを更新しました")
    }

    setIsAdding(false)
    setEditingId(null)
    setFormData({
      campaignName: "",
      channel: "",
      startDate: null,
      endDate: null,
      source: "manual",
      rooms: 0,
      adrImpact: 0,
      revParImpact: 0,
      description: "",
    })
  }

  const handleDelete = (id: string) => {
    setCampaigns(campaigns.filter((c) => c.id !== id))
    toast.success("キャンペーンを削除しました")
  }

  const handleCancel = () => {
    setIsAdding(false)
    setEditingId(null)
    setFormData({
      campaignName: "",
      channel: "",
      startDate: null,
      endDate: null,
      source: "manual",
      rooms: 0,
      adrImpact: 0,
      revParImpact: 0,
      description: "",
    })
  }

  const handleImportOTA = async (channel: string) => {
    toast.info(`${channel}からデータを取得中...`, {
      description: "この機能は今後実装されます。",
    })
    // 将来的にOTA APIと統合
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">キャンペーン参画データ管理</h2>
          <p className="text-sm text-muted-foreground mt-1">
            各OTA管理画面からデータを取得、または手動で入力してください
          </p>
        </div>
        <Button onClick={handleAdd} className="gap-2">
          <Plus className="w-4 h-4" />
          新規追加
        </Button>
      </div>

      {/* OTAデータ取得セクション */}
      <Card>
        <CardHeader>
          <CardTitle>OTA管理画面からデータ取得</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {channels.slice(0, 6).map((channel) => (
              <Button
                key={channel}
                variant="outline"
                className="flex flex-col items-center gap-2 h-auto py-4"
                onClick={() => handleImportOTA(channel)}
              >
                <Download className="w-5 h-5" />
                <span className="text-sm">{channel}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 手動入力フォーム */}
      {(isAdding || editingId) && (
        <Card>
          <CardHeader>
            <CardTitle>{isAdding ? "新規キャンペーン追加" : "キャンペーン編集"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="campaignName">キャンペーン名 *</Label>
                  <Input
                    id="campaignName"
                    value={formData.campaignName}
                    onChange={(e) => setFormData({ ...formData, campaignName: e.target.value })}
                    placeholder="例: ビジネスキャンペーン"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="channel">チャンネル *</Label>
                  <Select
                    value={formData.channel}
                    onValueChange={(value) => setFormData({ ...formData, channel: value })}
                  >
                    <SelectTrigger id="channel">
                      <SelectValue placeholder="チャンネルを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((channel) => (
                        <SelectItem key={channel} value={channel}>
                          {channel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>開始日 *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.startDate ? (
                          format(formData.startDate, "yyyy年MM月dd日", { locale: ja })
                        ) : (
                          <span>開始日を選択</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.startDate || undefined}
                        onSelect={(date) => setFormData({ ...formData, startDate: date || null })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>終了日 *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.endDate ? (
                          format(formData.endDate, "yyyy年MM月dd日", { locale: ja })
                        ) : (
                          <span>終了日を選択</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.endDate || undefined}
                        onSelect={(date) => setFormData({ ...formData, endDate: date || null })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rooms">増加室数</Label>
                  <Input
                    id="rooms"
                    type="number"
                    value={formData.rooms}
                    onChange={(e) => setFormData({ ...formData, rooms: Number(e.target.value) })}
                    placeholder="150"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adrImpact">ADR影響率 (%)</Label>
                  <Input
                    id="adrImpact"
                    type="number"
                    value={formData.adrImpact}
                    onChange={(e) => setFormData({ ...formData, adrImpact: Number(e.target.value) })}
                    placeholder="103"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="revParImpact">REV-Per影響率 (%)</Label>
                  <Input
                    id="revParImpact"
                    type="number"
                    value={formData.revParImpact}
                    onChange={(e) => setFormData({ ...formData, revParImpact: Number(e.target.value) })}
                    placeholder="118"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">説明・備考</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="キャンペーンの詳細を入力..."
                  rows={3}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleCancel}>
                  キャンセル
                </Button>
                <Button onClick={handleSave} className="gap-2">
                  <Save className="w-4 h-4" />
                  保存
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* キャンペーン一覧 */}
      <Card>
        <CardHeader>
          <CardTitle>登録済みキャンペーン一覧</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              キャンペーンが登録されていません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>キャンペーン名</TableHead>
                    <TableHead>チャンネル</TableHead>
                    <TableHead>期間</TableHead>
                    <TableHead>増加室数</TableHead>
                    <TableHead>ADR影響</TableHead>
                    <TableHead>REV-Per影響</TableHead>
                    <TableHead>データソース</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">{campaign.campaignName}</TableCell>
                      <TableCell>{campaign.channel}</TableCell>
                      <TableCell>
                        {campaign.startDate && campaign.endDate
                          ? `${format(campaign.startDate, "MM/dd", { locale: ja })} ～ ${format(campaign.endDate, "MM/dd", { locale: ja })}`
                          : "-"}
                      </TableCell>
                      <TableCell>{campaign.rooms > 0 ? `${campaign.rooms}室` : "-"}</TableCell>
                      <TableCell>{campaign.adrImpact > 0 ? `${campaign.adrImpact}%` : "-"}</TableCell>
                      <TableCell>{campaign.revParImpact > 0 ? `${campaign.revParImpact}%` : "-"}</TableCell>
                      <TableCell>
                        <Badge variant={campaign.source === "ota" ? "default" : "secondary"}>
                          {campaign.source === "ota" ? "OTA取得" : "手動入力"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(campaign)}
                          >
                            編集
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(campaign.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

