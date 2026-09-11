"use client"

// 日別の詳細情報ダイアログ（U-15 で pricing-tab.tsx から分割）
// イベント情報・外部要因メモは保存APIが未整備のため、画面内の一時メモとして親が保持する。

import { useState } from "react"
import { Edit2, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { demandDescription } from "@/components/pricing/pricing-constants"
import { DAY_NAMES } from "@/lib/date"
import { formatPercent as pct, formatYen as yen } from "@/lib/format"
import type { PricingCalendarDay } from "@/lib/api"

/** 日別の自由記述メモ（イベント情報・外部要因情報） */
export interface DayNote {
  eventInfo?: string
  externalFactors?: string
}

interface DayDetailDialogProps {
  day: PricingCalendarDay | null
  info: DayNote | undefined
  onClose: () => void
  onSaveInfo: (date: string, note: DayNote) => void
}

export function DayDetailDialog({ day, info, onClose, onSaveInfo }: DayDetailDialogProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingEventInfo, setEditingEventInfo] = useState("")
  const [editingExternalFactors, setEditingExternalFactors] = useState("")

  return (
    <Dialog
      open={day !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
          setIsEditing(false)
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {day &&
          (() => {
            const [y, m, d] = day.date.split("-").map(Number)
            const dow = new Date(day.date).getDay()
            const dateString = `${y}年${m}月${d}日（${DAY_NAMES[dow]}）`
            const savedInfo = info

            const handleEditStart = () => {
              setEditingEventInfo(savedInfo?.eventInfo || "")
              setEditingExternalFactors(savedInfo?.externalFactors || "")
              setIsEditing(true)
            }

            const handleSave = () => {
              onSaveInfo(day.date, {
                eventInfo: editingEventInfo || undefined,
                externalFactors: editingExternalFactors || undefined,
              })
              setIsEditing(false)
            }

            return (
              <>
                <DialogHeader>
                  <DialogTitle>{dateString} の詳細情報</DialogTitle>
                  <DialogDescription>AIによる推奨価格・需要アラートの詳細です</DialogDescription>
                </DialogHeader>

                <div className="space-y-6 mt-4">
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">推奨価格（料金ランク {day.rankLabel ?? "-"}）</div>
                      {day.confidence != null && <Badge variant="outline" className="text-xs">信頼度 {(day.confidence * 100).toFixed(0)}%</Badge>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                      <div>1名料金：{yen(day.price1P)}</div>
                      <div>2名料金：{yen(day.price2P)}</div>
                      <div>3名料金：{yen(day.price3P)}</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t pt-3">
                      <div>アラート：{day.demandLevel ?? "-"}（{demandDescription(day.demandLevel)}）</div>
                      <div>稼働率予測：{pct(day.predictedOccupancy)}</div>
                      <div>競合価格水準（中央値）：{yen(day.competitorMedianPrice)}</div>
                      <div>AI予測ADR：{yen(day.predictedAdr)}</div>
                      {day.actualAdr != null && <div>実績ADR：{yen(day.actualAdr)}</div>}
                      {day.actualOccupancy != null && <div>実績稼働率：{pct(day.actualOccupancy)}</div>}
                    </div>
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-base">イベント情報・外部要因情報</h3>
                      {!isEditing && (
                        <Button variant="outline" size="sm" onClick={handleEditStart} className="gap-2">
                          <Edit2 className="w-4 h-4" />
                          編集
                        </Button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="event-info">イベント情報</Label>
                          <Textarea
                            id="event-info"
                            placeholder="例：○○ホールで○○コンサート予定です"
                            value={editingEventInfo}
                            onChange={(e) => setEditingEventInfo(e.target.value)}
                            rows={3}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="external-factors">外部要因情報</Label>
                          <Textarea
                            id="external-factors"
                            placeholder="例：天候、交通機関の遅延、その他の要因"
                            value={editingExternalFactors}
                            onChange={(e) => setEditingExternalFactors(e.target.value)}
                            rows={3}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={handleSave} className="gap-2">
                            <Save className="w-4 h-4" />
                            保存
                          </Button>
                          <Button variant="outline" onClick={() => setIsEditing(false)}>
                            キャンセル
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        {savedInfo?.eventInfo && (
                          <div className="p-3 bg-primary/5 rounded-lg">
                            <div className="font-medium mb-1">イベント情報</div>
                            <div className="text-muted-foreground">{savedInfo.eventInfo}</div>
                          </div>
                        )}
                        {savedInfo?.externalFactors && (
                          <div className="p-3 bg-warning/10 rounded-lg">
                            <div className="font-medium mb-1">外部要因情報</div>
                            <div className="text-muted-foreground">{savedInfo.externalFactors}</div>
                          </div>
                        )}
                        {!savedInfo?.eventInfo && !savedInfo?.externalFactors && (
                          <div className="text-muted-foreground text-sm">イベント情報・外部要因情報は未設定です</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )
          })()}
      </DialogContent>
    </Dialog>
  )
}
