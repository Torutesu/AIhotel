"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Brain,
  ExternalLink,
  Sun,
  Plane,
  Calendar,
  Building2,
  CloudRain,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { XAxis, YAxis, CartesianGrid, BarChart, Bar, ComposedChart, Line, ReferenceLine, ReferenceArea, Legend, Area } from "recharts"

/** 本番想定のダミーKPI（デモ用） */
type FactorKpi = { label: string; value: string; hint?: string }

type ExternalFactorRow = {
  name: string
  status: string
  trend: string
  note: string
  kpis?: FactorKpi[]
}

// 先6ヶ月の月別予測データ（2026年2月〜7月）
const monthlyForecastData = [
  { month: "2月", demandIndex: 75, climate: 60, inbound: 70, events: 85, access: 75 },
  { month: "3月", demandIndex: 90, climate: 75, inbound: 85, events: 95, access: 80 },
  { month: "4月", demandIndex: 95, climate: 85, inbound: 90, events: 100, access: 85 },
  { month: "5月", demandIndex: 100, climate: 90, inbound: 95, events: 95, access: 90 },
  { month: "6月", demandIndex: 70, climate: 50, inbound: 75, events: 60, access: 70 },
  { month: "7月", demandIndex: 85, climate: 65, inbound: 85, events: 80, access: 85 },
]

// 外部要因カテゴリ別の影響度データ（数値はデモ用ダミー）
const externalFactorsData: Record<string, { name: string; icon: LucideIcon; color: string; factors: ExternalFactorRow[] }> = {
  climate: {
    name: "気候要因",
    icon: Sun,
    color: "hsl(var(--chart-1))",
    factors: [
      {
        name: "気温",
        status: "normal",
        trend: "up",
        note: "3〜5月は好天寄りの長期予報。快適指数が需要にプラス",
        kpis: [
          { label: "予報偏差（3-5月平均）", value: "+1.6°C", hint: "気象庁週次アンサンブル比" },
          { label: "需要寄与（指数）", value: "+2.8pt", hint: "当館モデル推定" },
        ],
      },
      {
        name: "梅雨",
        status: "warning",
        trend: "down",
        note: "6月入梅は平年比やや早め。週末レジャー需要に抑制",
        kpis: [
          { label: "降雨日数（6月予測）", value: "18日", hint: "平年比 +3日" },
          { label: "需要寄与（指数）", value: "-11.4pt", hint: "過去類似年から推定" },
        ],
      },
      {
        name: "台風",
        status: "warning",
        trend: "down",
        note: "接近シナリオ時は過去5年同帯の実績からキャンセル・新規を推定（下記は代表シナリオ）",
        kpis: [
          { label: "想定キャンセル増（7日窓）", value: "+27件", hint: "ピーク日±3日・全チャネル合算" },
          { label: "想定新規予約", value: "-9件", hint: "同一窓・ネット直販中心" },
          { label: "純影響（室夜）", value: "-41室夜", hint: "延べ・加重平均" },
          { label: "稼働率インパクト", value: "-3.6pt", hint: "前年同週比換算" },
          { label: "モデル信頼度", value: "74%", hint: "類似気象イベント n=12" },
        ],
      },
    ],
  },
  inbound: {
    name: "インバウンド動向",
    icon: Plane,
    color: "hsl(var(--chart-2))",
    factors: [
      {
        name: "JNTOデータ",
        status: "positive",
        trend: "up",
        note: "当エリアの宿泊者数トレンドは前年を上回る見込み",
        kpis: [
          { label: "前年比（推定）", value: "+12.4%", hint: "直近3ヶ月移動平均" },
          { label: "月間宿泊者数（推定）", value: "約118万人", hint: "広域エリア指標" },
        ],
      },
      {
        name: "海外SNS傾向",
        status: "positive",
        trend: "up",
        note: "桜・温泉関連ハッシュタグの投稿量が季節要因で増加",
        kpis: [
          { label: "投稿量 YoY", value: "+31%", hint: "主要3言語・週次" },
          { label: "センチメント", value: "0.71", hint: "−1〜1 正が好意的" },
        ],
      },
      {
        name: "為替影響",
        status: "positive",
        trend: "up",
        note: "円安継続でインバウンド客単価が押し上げ",
        kpis: [
          { label: "USD/JPY（参考）", value: "¥157.8", hint: "予測レンジ 154〜161" },
          { label: "客単価寄与", value: "+2.3%", hint: "当館モデル・為替感応度" },
        ],
      },
    ],
  },
  events: {
    name: "イベント",
    icon: Calendar,
    color: "hsl(var(--chart-3))",
    factors: [
      {
        name: "桜開花",
        status: "positive",
        trend: "up",
        note: "開花平年並み〜やや早め。ピーク週の検索需要が先行上昇",
        kpis: [
          { label: "満開予想ピーク", value: "4/1〜4/4", hint: "地域モデル" },
          { label: "検索需要指数", value: "+26%", hint: "前年同週比" },
        ],
      },
      {
        name: "GW",
        status: "positive",
        trend: "up",
        note: "連休カレンダー良好。連泊・ファミリー需要が堅調",
        kpis: [
          { label: "稼働率予測", value: "93.8%", hint: "4/29〜5/5" },
          { label: "RevPAR 予測伸び", value: "+17.2%", hint: "前年同週比" },
        ],
      },
      {
        name: "コンサート・祭事",
        status: "normal",
        trend: "neutral",
        note: "都心大型イベントは週次で変動。直近は小規模が中心",
        kpis: [
          { label: "週次イベント件数", value: "14件", hint: "半径50km" },
          { label: "当館需要寄与", value: "+0.9pt", hint: "平均的週への上乗せ" },
        ],
      },
    ],
  },
  access: {
    name: "アクセス",
    icon: Plane,
    color: "hsl(var(--chart-4))",
    factors: [
      {
        name: "国際線",
        status: "positive",
        trend: "up",
        note: "当空港の国際座席供給が増便・機材大型化で拡大",
        kpis: [
          { label: "座席供給 YoY", value: "+8.6%", hint: "夏ダイヤ想定込み" },
          { label: "ロード係数（参考）", value: "82.4%", hint: "直近週" },
        ],
      },
      {
        name: "国内線",
        status: "normal",
        trend: "neutral",
        note: "便数はおおむね横ばい。遅延率のみやや注意",
        kpis: [
          { label: "便数 前月比", value: "+0.4%", hint: "季節調整後" },
          { label: "定時運航率", value: "88.1%", hint: "当空港発着" },
        ],
      },
      {
        name: "高速道路",
        status: "normal",
        trend: "neutral",
        note: "GW期間は渋滞指数が上昇。ドライブ需要の日帰り圧が変動",
        kpis: [
          { label: "GW渋滞指数", value: "6.2/10", hint: "10が最悪・予測モデル" },
          { label: "所要時間延長（ピーク日）", value: "+38分", hint: "主要IC間・中央値" },
        ],
      },
    ],
  },
  hotels: {
    name: "新規ホテル",
    icon: Building2,
    color: "hsl(var(--chart-5))",
    factors: [
      {
        name: "周辺新規開業",
        status: "warning",
        trend: "down",
        note: "4月に同商圈で客室数が一括増。価格競争が一段と活発化",
        kpis: [
          { label: "新規供給（客室数）", value: "+186室", hint: "2物件合算" },
          { label: "推定シェア押下", value: "-1.9pt", hint: "稼働率ベース・12ヶ月先" },
          { label: "開業日", value: "4/12・4/28", hint: "プレオープン除く" },
        ],
      },
    ],
  },
}

// 週別の詳細予測データ（デイリー/時間軸c対応）
const weeklyDetailData = [
  { week: "W5 (1/27-)", base: 70, event: 5, inbound: 10, climate: 0, total: 85 },
  { week: "W6 (2/3-)", base: 75, event: 15, inbound: 20, climate: 0, total: 110, label: "春節" },
  { week: "W7 (2/10-)", base: 70, event: 10, inbound: 15, climate: 0, total: 95 },
  { week: "W8 (2/17-)", base: 68, event: 5, inbound: 10, climate: 0, total: 83, label: "受験" },
  { week: "W9 (2/24-)", base: 70, event: 5, inbound: 8, climate: 0, total: 83 },
  { week: "W10 (3/3-)", base: 75, event: 10, inbound: 12, climate: 5, total: 102 },
  { week: "W11 (3/10-)", base: 80, event: 15, inbound: 15, climate: 5, total: 115, label: "春休み開始" },
  { week: "W12 (3/17-)", base: 85, event: 20, inbound: 25, climate: 5, total: 135, label: "桜開花" },
]

// チャート設定
const forecastChartConfig = {
  demandIndex: { label: "総合需要指数", color: "hsl(var(--chart-1))" },
  climate: { label: "気候要因", color: "hsl(var(--chart-2))" },
  inbound: { label: "インバウンド", color: "hsl(var(--chart-3))" },
  events: { label: "イベント", color: "hsl(var(--chart-4))" },
}

const weeklyChartConfig = {
  base: { label: "ベース需要", color: "hsl(210, 70%, 50%)" },
  event: { label: "イベント効果", color: "hsl(150, 70%, 50%)" },
  inbound: { label: "インバウンド効果", color: "hsl(30, 70%, 50%)" },
  climate: { label: "気候効果", color: "hsl(280, 70%, 50%)" },
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <TrendingUp className="w-4 h-4 text-green-500" />
  if (trend === "down") return <TrendingDown className="w-4 h-4 text-red-500" />
  return <Minus className="w-4 h-4 text-gray-400" />
}

function StatusBadge({ status }: { status: string }) {
  if (status === "positive") return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">好調</Badge>
  if (status === "warning") return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">注意</Badge>
  if (status === "normal") return <Badge variant="secondary">通常</Badge>
  return <Badge variant="outline">-</Badge>
}

export function AISummaryTab() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="w-6 h-6" />
          AIまとめ - 外部要因動向予測
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          外部要因に基づく先6ヶ月（2026年2月〜7月）のマーケット動向予測
        </p>
      </div>

      {/* AI総合コメント */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 dark:from-blue-950/30 dark:to-indigo-950/30 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            AI総合予測コメント
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm leading-relaxed">
            <p>
              <strong>【先6ヶ月の総合見通し】</strong><br />
              2026年2月〜7月の期間は、<span className="text-blue-600 dark:text-blue-400 font-medium">3月下旬〜5月上旬が最大の需要期</span>となる見込みです。
              中国春節（2月上旬）のインバウンド需要に始まり、桜シーズン・ゴールデンウィークと続く高需要期間では、
              価格戦略の最適化が収益最大化の鍵となります。
            </p>
            <p>
              <strong>【注意事項】</strong><br />
              <span className="text-amber-600 dark:text-amber-400">6月の梅雨シーズン</span>は需要が大幅に落ち込む予測のため、
              早期の価格調整とプロモーション施策の準備を推奨します。
              また、<span className="text-amber-600 dark:text-amber-400">4月に周辺で2軒の新規ホテルが開業予定</span>のため、
              競合動向の監視を強化してください。
            </p>
            <p>
              <strong>【推奨アクション】</strong><br />
              ・桜シーズン（3月下旬〜4月上旬）：早期予約促進キャンペーンの実施<br />
              ・GW（4/29〜5/5）：連泊割引プランの準備<br />
              ・梅雨期（6月）：平日限定プランや地元向けプロモーションの検討
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 先6ヶ月の需要予測グラフ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            月別需要指数予測（2026年2月〜7月）
          </CardTitle>
          <CardDescription>
            外部要因を加味した総合需要指数の推移予測（100が平均需要）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={forecastChartConfig} className="h-[300px] w-full">
            <ComposedChart data={monthlyForecastData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis domain={[0, 120]} className="text-xs" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <ReferenceArea x1="3月" x2="5月" fill="hsl(var(--chart-3))" fillOpacity={0.1} />
              <ReferenceLine y={80} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" label={{ value: "平均", position: "right", fontSize: 10 }} />
              <Area type="monotone" dataKey="demandIndex" name="総合需要指数" fill="hsl(var(--chart-1))" fillOpacity={0.3} stroke="hsl(var(--chart-1))" strokeWidth={2} />
              <Line type="monotone" dataKey="inbound" name="インバウンド" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="events" name="イベント" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="climate" name="気候" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={{ r: 4 }} />
            </ComposedChart>
          </ChartContainer>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            季節イベントや大型連休などの外部要因は、AIが事前学習した知識として保持し、実際に需要曲線へ影響が及ぶタイミングでコメントとして表示されます。
            台風などの気象リスク発生時には、過去実績に基づき想定キャンセル数・新規予約数をAIが予測します（本画面はデモ表示です）。
          </p>
        </CardContent>
      </Card>

      {/* 週別詳細予測（デイリー対応）*/}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            週別需要予測（直近8週間）
          </CardTitle>
          <CardDescription>
            要因別の需要貢献度を積み上げグラフで表示（時間軸c: デイリー対応）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={weeklyChartConfig} className="h-[280px] w-full">
            <BarChart data={weeklyDetailData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="week" className="text-xs" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 150]} className="text-xs" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <ReferenceLine y={100} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: "高需要ライン", position: "right", fontSize: 10 }} />
              <Bar dataKey="base" name="ベース需要" stackId="a" fill="hsl(210, 70%, 50%)" />
              <Bar dataKey="event" name="イベント効果" stackId="a" fill="hsl(150, 70%, 50%)" />
              <Bar dataKey="inbound" name="インバウンド効果" stackId="a" fill="hsl(30, 70%, 50%)" />
              <Bar dataKey="climate" name="気候効果" stackId="a" fill="hsl(280, 70%, 50%)" />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* 外部要因カテゴリ別詳細（時間軸b: 要因による期間） */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(externalFactorsData).map(([key, category]) => {
          const IconComponent = category.icon
          return (
            <Card key={key}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconComponent className="w-4 h-4" />
                  {category.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {category.factors.map((factor, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <TrendIcon trend={factor.trend} />
                        <span>{factor.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={factor.status} />
                      </div>
                    </div>
                  ))}
                  <div className="space-y-3 pt-2 border-t">
                    {category.factors.map((factor, idx) => (
                      <div key={idx} className="rounded-md bg-muted/40 px-2.5 py-2">
                        <p className="text-xs text-muted-foreground leading-snug">
                          <span className="font-medium text-foreground">{factor.name}</span>
                          <span className="text-muted-foreground"> — {factor.note}</span>
                        </p>
                        {factor.kpis && factor.kpis.length > 0 ? (
                          <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2">
                            {factor.kpis.map((kpi, k) => (
                              <div key={k} className="flex flex-col gap-0.5 border-l-2 border-primary/25 pl-2">
                                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</dt>
                                <dd className="text-sm font-semibold tabular-nums tracking-tight">{kpi.value}</dd>
                                {kpi.hint ? <span className="text-[10px] text-muted-foreground">{kpi.hint}</span> : null}
                              </div>
                            ))}
                          </dl>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 注意事項 */}
      <Card className="bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5" />
            今後の注意事項
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <CloudRain className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
              <div>
                <span className="font-medium">梅雨シーズン（6月）</span>: 需要指数は<span className="tabular-nums font-medium">70</span>
                前後まで低下する見込み（前年同月比<span className="tabular-nums">-8.1%</span>想定）。早期の価格調整とプロモーション施策を準備してください。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Building2 className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
              <div>
                <span className="font-medium">新規ホテル開業（4月）</span>: 周辺<span className="tabular-nums">2</span>軒・計
                <span className="tabular-nums">186</span>室の供給増。推定で稼働率
                <span className="tabular-nums">-1.9pt</span>の押下リスク。競合価格の監視と差別化を検討してください。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <ExternalLink className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
              <div>
                <span className="font-medium">インバウンド動向</span>: 中国春節期間中（2/1〜2/12頃）はピーク日で新規予約
                <span className="tabular-nums">+340</span>件/日（前年比<span className="tabular-nums">+19%</span>）のシナリオ。オペレーションと在庫配分の余裕を確保してください。
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
