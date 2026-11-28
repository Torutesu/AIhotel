"use client"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { USAGE_LABELS, type UsageEvent } from '@shared/types/usage'
import type { ChartTooltipProps } from '@/lib/chart-tooltip'
import { formatUsageTime, type usageOverview } from '@/lib/usage-insights'

type Daily = ReturnType<typeof usageOverview>['daily'][number]
function DailyTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const row=payload[0].payload as Daily
  return <div className="rounded-md border bg-background p-3 text-xs leading-6 shadow-sm"><p className="font-medium">{row.day}</p><p>画面閲覧：{row.views}回</p><p>操作完了：{row.actions}回</p><p>利用アカウント：{row.accounts}件</p></div>
}
export function UsageDailyChart({ days }: { days: Daily[] }) {
  const measured=days.filter(d=>d.measured)
  const any=measured.some(d=>d.views+d.actions>0)
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">日別の利用推移</h3><div className="flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-2"><i className="size-2 rounded-sm bg-foreground"/>画面閲覧</span><span className="flex items-center gap-2"><i className="size-2 rounded-sm bg-blue-700 dark:bg-blue-400"/>操作完了</span></div></div>
    {any ? <div className="h-56 min-w-0 text-xs [--usage-action:#1d4ed8] dark:[--usage-action:#60a5fa]" role="img" aria-label="日別の画面閲覧・操作完了の積み上げ棒グラフ。下の表でも数値を確認できます。">
      <ResponsiveContainer width="100%" height="100%"><BarChart data={measured} margin={{top:8,right:8,left:-18,bottom:0}} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)"/>
        <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={25} tick={{fill:'var(--muted-foreground)',fontSize:11}}/>
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{fill:'var(--muted-foreground)',fontSize:11}}/>
        <Tooltip content={<DailyTooltip/>} cursor={{fill:'var(--muted)',opacity:.4}}/>
        <Bar dataKey="views" name="画面閲覧" stackId="usage" fill="var(--foreground)" maxBarSize={24} isAnimationActive={false}/>
        <Bar dataKey="actions" name="操作完了" stackId="usage" fill="var(--usage-action)" maxBarSize={24} isAnimationActive={false}/>
      </BarChart></ResponsiveContainer>
    </div> : <p className="flex min-h-40 items-center justify-center rounded-md border border-dashed px-5 text-center text-sm leading-6 text-muted-foreground">この期間にグラフ表示できる操作記録はありません。</p>}
    <p className="text-xs leading-5 text-muted-foreground">縦軸は回数。計測開始前の日は表示しません。今日の数値は途中経過です。</p>
    <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3 underline underline-offset-4">日別の数値を表で確認</summary><div className="max-h-56 overflow-auto rounded-md border"><table className="w-full text-right text-xs"><caption className="sr-only">日別の利用記録</caption><thead className="sticky top-0 bg-background"><tr className="border-b"><th className="p-3 text-left">日付</th><th className="p-3">閲覧</th><th className="p-3">完了</th><th className="p-3">利用</th></tr></thead><tbody>{measured.slice().reverse().map(d=><tr key={d.day} className="border-b last:border-0"><th scope="row" className="p-3 text-left font-normal whitespace-nowrap">{d.day}</th><td className="p-3 tabular-nums">{d.views}回</td><td className="p-3 tabular-nums">{d.actions}回</td><td className="p-3 tabular-nums">{d.accounts}件</td></tr>)}{!measured.length&&<tr><td colSpan={4} className="p-4 text-left text-muted-foreground">記録はまだありません。</td></tr>}</tbody></table></div></details>
  </div>
}
export function UsageFeatureBars({ counts, events, lastByEvent }: { counts: Record<UsageEvent,number>; events: readonly UsageEvent[]; lastByEvent?: Partial<Record<UsageEvent,string>> }) {
  const max=Math.max(1,...events.map(e=>counts[e]))
  return <dl className="space-y-4">{events.map(e=><div key={e} className="space-y-2"><div className="flex justify-between gap-3 text-sm"><dt>{USAGE_LABELS[e]}</dt><dd className="shrink-0 font-medium tabular-nums">{counts[e].toLocaleString()}回</dd></div><div className="h-1.5 overflow-hidden rounded-sm bg-muted" aria-hidden><div className={e.startsWith('view_')?'h-full bg-foreground':'h-full bg-blue-700 dark:bg-blue-400'} style={{width:`${counts[e]/max*100}%`}}/></div>{lastByEvent&&counts[e]>0&&<p className="text-xs text-muted-foreground">最終：{lastByEvent[e]?formatUsageTime(lastByEvent[e]):'時刻は未計測（日別回数のみ）'}</p>}</div>)}</dl>
}
