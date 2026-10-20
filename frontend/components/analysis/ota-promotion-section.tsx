"use client"

// OTA販促状況（2026-10 PDF c分析06。フリー分析から独立したタブへ移した）。
// 各 OTA の実績管理画面から販促（キャンペーン・クーポン）の参加状況と実績を取り込んで一覧にする。
// 取り込み（スクレイピング）は Phase 4 のため未実装で、一覧・取得状況はサンプル表示。
//  - 掲示順: 販促内容一覧 → OTA販促データ更新（PDF「掲示順を逆に」）
//  - 一覧の項目: 販促名・チャネル・内容・処理期限（終了したら色付け）・実施期間・予約対象期間・参加状況・前年実績、
//    実績は 販売室数・販売額・消費数（クーポンなど）・実費用（増加室数・ADR・REV-Per の影響は出さない。関与数は再調査の後）
//  - データは毎週火曜日に更新し、それ以外の日は OTA ごとの更新ボタンで取り直す

import { useMemo } from "react"
import { AlertTriangle, KeyRound, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { formatRooms, formatYen } from "@/lib/format"
import { cn } from "@/lib/utils"

const SAMPLE_NOT_FETCHED = "サンプル表示のため取得は行いません（OTA からの取り込みは Phase 4 で実装します）。"

type Participation = "参加" | "不参加" | "検討中"
type LastYear = "参加" | "不参加" | "なし"

export interface OtaPromotion {
  id: string
  name: string
  channel: string
  content: string
  /** 処理期限（参加の申込・設定の締切） */
  deadline: string
  /** 実施期間 */
  period: [string, string]
  /** 予約対象期間（宿泊日） */
  stayPeriod: [string, string]
  participation: Participation
  /** 前年の同じ販促への参加 */
  lastYear: LastYear
  soldRooms: number | null
  sales: number | null
  /** 消費数（クーポンなど） */
  redeemed: number | null
  /** 実費用 */
  cost: number | null
}

/** OTA ごとの取得状況（サンプル）。一休.com はパスワードの期限切れで取得に失敗した例 */
const OTA_SOURCES: Array<{ channel: string; facilityId: string; status: "ok" | "failed"; message?: string; passwordDaysLeft: number | null }> = [
  { channel: "楽天トラベル", facilityId: "R-102845", status: "ok", passwordDaysLeft: 12 },
  { channel: "じゃらん", facilityId: "J-558214", status: "ok", passwordDaysLeft: 3 },
  { channel: "一休.com", facilityId: "I-30412", status: "failed", message: "一休.comのデータが取得できませんでした。パスワードの更新が必要です。", passwordDaysLeft: null },
  { channel: "Booking.com", facilityId: "B-7729481", status: "ok", passwordDaysLeft: 64 },
  { channel: "Expedia", facilityId: "E-4451920", status: "ok", passwordDaysLeft: null },
  { channel: "Agoda", facilityId: "A-995127", status: "ok", passwordDaysLeft: 41 },
]

const PASSWORD_ALERT_THRESHOLD_DAYS = 14

const pad = (n: number) => String(n).padStart(2, "0")
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (base: Date, days: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)

/** 直近の火曜日（今日が火曜なら今日） */
export function lastTuesday(today: Date): Date {
  const diff = (today.getDay() - 2 + 7) % 7
  return addDays(today, -diff)
}

/** サンプルの販促一覧（今日を基準に日付を作る。処理期限が過ぎたものと、これからのものを混ぜる） */
export function sampleOtaPromotions(today: Date): OtaPromotion[] {
  const d = (days: number) => iso(addDays(today, days))
  return [
    { id: "p1", name: "楽天スーパーSALE", channel: "楽天トラベル", content: "最大50%OFF・ポイント最大10倍", deadline: d(-12), period: [d(-5), d(2)], stayPeriod: [d(-5), d(90)], participation: "参加", lastYear: "参加", soldRooms: 182, sales: 3_276_000, redeemed: null, cost: 98_280 },
    { id: "p2", name: "じゃらんスペシャルウィーク", channel: "じゃらん", content: "クーポン 2,000円OFF（先着300枚）", deadline: d(-3), period: [d(3), d(10)], stayPeriod: [d(3), d(60)], participation: "参加", lastYear: "不参加", soldRooms: 64, sales: 1_152_000, redeemed: 41, cost: 82_000 },
    { id: "p3", name: "一休 タイムセール", channel: "一休.com", content: "直前割 15%OFF", deadline: d(4), period: [d(8), d(14)], stayPeriod: [d(8), d(30)], participation: "検討中", lastYear: "参加", soldRooms: null, sales: null, redeemed: null, cost: null },
    { id: "p4", name: "Booking.com Getaway Deal", channel: "Booking.com", content: "15%以上の割引で露出アップ", deadline: d(9), period: [d(14), d(28)], stayPeriod: [d(14), d(120)], participation: "参加", lastYear: "なし", soldRooms: null, sales: null, redeemed: null, cost: null },
    { id: "p5", name: "Expedia 秋のセール", channel: "Expedia", content: "会員価格 10%OFF", deadline: d(-20), period: [d(-14), d(-1)], stayPeriod: [d(-14), d(45)], participation: "不参加", lastYear: "不参加", soldRooms: null, sales: null, redeemed: null, cost: null },
    { id: "p6", name: "Agoda 24時間限定セール", channel: "Agoda", content: "モバイル限定 20%OFF", deadline: d(-30), period: [d(-25), d(-24)], stayPeriod: [d(-25), d(30)], participation: "参加", lastYear: "参加", soldRooms: 23, sales: 368_000, redeemed: null, cost: 55_200 },
  ]
}

const fmtDate = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
const fmtRange = ([a, b]: [string, string]) => `${fmtDate(a)}〜${fmtDate(b)}`

function ParticipationBadge({ value }: { value: Participation | LastYear }) {
  return (
    <Badge variant={value === "参加" ? "default" : "outline"} className={cn("text-[11px]", value === "なし" && "text-muted-foreground")}>
      {value}
    </Badge>
  )
}

export function OtaPromotionSection() {
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])
  const promotions = useMemo(() => sampleOtaPromotions(today), [today])
  const updatedOn = lastTuesday(today)
  const todayIso = iso(today)
  const sourceAlerts = OTA_SOURCES.filter(
    (s) => s.status === "failed" || (s.passwordDaysLeft != null && s.passwordDaysLeft <= PASSWORD_ALERT_THRESHOLD_DAYS),
  )

  return (
    <div className="space-y-4">
      <SampleDataNotice detail="OTA の実績管理画面からの取り込み（Phase 4）が未実装のため、販促一覧と取得状況はサンプルです。" />

      {sourceAlerts.length > 0 && (
        <Alert className="border-warning/30 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-sm font-semibold text-warning">OTAアカウントの確認が必要です</AlertTitle>
          <AlertDescription className="mt-1 space-y-1.5 text-xs text-warning/90">
            {sourceAlerts.map((s) => (
              <div key={s.channel} className="flex flex-wrap items-center justify-between gap-2" data-testid="ota-source-alert">
                <p>
                  • <span className="font-semibold">{s.channel}</span>（施設ID: {s.facilityId}）:{" "}
                  {s.status === "failed" ? (
                    <span className="font-semibold text-negative">{s.message}</span>
                  ) : (
                    <>
                      パスワードをあと<span className={cn("font-bold", (s.passwordDaysLeft ?? 0) <= 7 && "text-negative")}>{s.passwordDaysLeft}日以内</span>
                      に更新してください
                    </>
                  )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => toast.info(`${s.channel}のパスワード更新`, { description: "本システム上からの更新処理は今後実装します。" })}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  パスワード更新
                </Button>
              </div>
            ))}
            <p className="text-[10px]">
              ※ データ取得には施設ID（OTAごと）・ユーザーID・パスワードの登録が必要です。OTAによっては3か月単位でのパスワード更新が求められます
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">販促内容一覧</CardTitle>
          <p className="text-xs text-muted-foreground">
            各 OTA の実績管理画面の値です。処理期限を過ぎた販促は色を付けています。関与数（販促が予約に関わった数）は再調査の後に表示します。
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] whitespace-nowrap text-xs" data-testid="ota-promotion-table">
              <thead>
                <tr className="border-b">
                  <th colSpan={8} className="px-2 py-1.5" />
                  <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">実績</th>
                </tr>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">販促名</th>
                  <th className="px-2 py-2 text-left font-medium">チャネル</th>
                  <th className="px-2 py-2 text-left font-medium">内容</th>
                  <th className="px-2 py-2 text-left font-medium">処理期限</th>
                  <th className="px-2 py-2 text-left font-medium">実施期間</th>
                  <th className="px-2 py-2 text-left font-medium">予約対象期間</th>
                  <th className="px-2 py-2 text-center font-medium">参加状況</th>
                  <th className="px-2 py-2 text-center font-medium">前年実績</th>
                  <th className="border-l px-2 py-2 text-right font-medium">販売室数</th>
                  <th className="px-2 py-2 text-right font-medium">販売額</th>
                  <th className="px-2 py-2 text-right font-medium">消費数</th>
                  <th className="px-2 py-2 text-right font-medium">実費用</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => {
                  const closed = p.deadline < todayIso
                  return (
                    <tr key={p.id} className="border-b hover:bg-muted/50">
                      <td className="px-2 py-2 font-medium">{p.name}</td>
                      <td className="px-2 py-2">{p.channel}</td>
                      <td className="whitespace-normal px-2 py-2 text-muted-foreground">{p.content}</td>
                      <td className={cn("px-2 py-2", closed && "bg-muted font-medium text-muted-foreground")} data-closed={closed || undefined}>
                        {fmtDate(p.deadline)}
                        {closed && <span className="ml-1 text-[10px]">終了</span>}
                      </td>
                      <td className="px-2 py-2">{fmtRange(p.period)}</td>
                      <td className="px-2 py-2">{fmtRange(p.stayPeriod)}</td>
                      <td className="px-2 py-2 text-center">
                        <ParticipationBadge value={p.participation} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <ParticipationBadge value={p.lastYear} />
                      </td>
                      <td className="border-l px-2 py-2 text-right tabular-nums">{formatRooms(p.soldRooms)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatYen(p.sales)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.redeemed == null ? "-" : `${p.redeemed.toLocaleString()}枚`}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatYen(p.cost)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">消費数はクーポンなど枚数のある販促だけです。実績は実施期間が始まってから入ります。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">OTA販促データ更新</CardTitle>
          <p className="text-xs text-muted-foreground">
            毎週火曜日にデータを更新します（前回 {fmtDate(iso(updatedOn))}）。それ以外の日に更新したいときは、対象 OTA の更新ボタンを押してください。
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {OTA_SOURCES.map((s) => (
              <div key={s.channel} className={cn("flex flex-col gap-2 rounded-lg border p-3", s.status === "failed" && "border-negative/40 bg-negative/5")}>
                <p className="text-sm font-medium">{s.channel}</p>
                <p className={cn("text-[10px]", s.status === "failed" ? "text-negative" : "text-muted-foreground")}>
                  {s.status === "failed" ? "取得に失敗しました" : `${fmtDate(iso(updatedOn))} 更新`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  aria-label={`${s.channel}の販促データを更新`}
                  onClick={() => toast.info(`${s.channel}の販促データを更新`, { description: SAMPLE_NOT_FETCHED })}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  更新
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
