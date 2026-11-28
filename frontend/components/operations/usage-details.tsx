"use client"
import type { UsageReport } from '@shared/types/usage'
import { USAGE_LABELS } from '@shared/types/usage'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { UsageDailyChart, UsageFeatureBars } from './usage-charts'
import { ACTION_EVENTS, VIEW_EVENTS, accountInsights, usageOverview, formatUsageTime, type UsageAccountSummary, type UsageInsight } from '@/lib/usage-insights'

export function UsageInsights({ items }: { items: UsageInsight[] }) {
  return <div className="grid gap-5 lg:grid-cols-3">{items.map(item=><div key={item.title} className="min-w-0 space-y-2 border-l-2 pl-4"><h3 className="text-sm font-semibold leading-6">{item.title}</h3><p className="text-sm leading-7 text-muted-foreground">{item.text}</p>{item.next&&<p className="text-xs leading-6">確認のヒント：{item.next}</p>}</div>)}</div>
}
export function UsageDetails({ current, data, period, now, onClose }: { current?: UsageAccountSummary; data: UsageReport; period: number; now: number; onClose:()=>void }) {
  const model=current?usageOverview({...data,accounts:[current]},period,now):null
  return <Dialog open={!!current} onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="min-w-0 sm:max-w-4xl">
    {current&&model&&<>
      <DialogHeader><DialogTitle className="break-words">{current.name}の活用状況</DialogTitle><DialogDescription className="break-all">直近{period}日 · {current.email??'対象範囲の集計'} · 日本時間</DialogDescription></DialogHeader>
      <dl className="grid grid-cols-2 gap-4 rounded-md border p-4 text-sm sm:grid-cols-4">{[
        ['利用日数',`${current.activeDays}日`],['閲覧 / 完了',`${current.views}回 / ${current.actions}回`],['最終操作',formatUsageTime(current.last)],['最終ログイン',current.lastLoginAt===undefined?'対象外':formatUsageTime(current.lastLoginAt)],
      ].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 tabular-nums">{value}</dd></div>)}</dl>
      <UsageDailyChart days={model.daily}/>
      <section className="space-y-4 border-b pb-5"><h3 className="text-sm font-semibold">この顧客の利用傾向</h3><UsageInsights items={accountInsights(current,data.source)}/></section>
      <div className="grid gap-7 border-t pt-5 sm:grid-cols-2"><section className="space-y-4"><h3 className="text-sm font-semibold">画面の閲覧</h3><UsageFeatureBars counts={current.counts} events={VIEW_EVENTS} lastByEvent={current.lastByEvent}/></section><section className="space-y-4"><h3 className="text-sm font-semibold">操作の完了</h3><UsageFeatureBars counts={current.counts} events={ACTION_EVENTS} lastByEvent={current.lastByEvent}/>{data.source==='trial'&&<p className="text-xs leading-6 text-muted-foreground">公開デモではレポート出力はできません。0回でも未活用とは判断しません。</p>}</section></div>
      <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">チャットの操作状況</h3><UsageFeatureBars counts={current.counts} events={['chat_sent','chat_retried','chat_completed','chat_failed']} lastByEvent={current.lastByEvent}/><p className="text-xs text-muted-foreground">送信・失敗・再試行は計測追加後の記録です。質問・回答の本文は保存しません。</p></section>
      <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">最近の操作</h3><p className="text-xs leading-6 text-muted-foreground">時刻付きの記録はこの機能の導入後から。日ごとに最新30件を保持し、選択期間の最新50件を表示します。日別回数には省略した記録も含みます。</p>{current.timeline.length?<ol className="divide-y">{current.timeline.map((event,i)=><li key={`${event.at}-${i}`} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{USAGE_LABELS[event.event]}</span><time dateTime={event.at} className="tabular-nums text-muted-foreground">{formatUsageTime(event.at)}</time></li>)}</ol>:<p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">時刻付きの操作履歴はまだありません。以前の記録は日別集計で確認できます。</p>}</section>
      <p className="text-xs leading-6 text-muted-foreground">未記録は未利用の断定ではありません。分析は記録された回数に基づく説明で、売上効果や解約意向を推定するものではありません。</p>
      <Button variant="outline" onClick={onClose}>詳細を閉じる</Button>
    </>}
  </DialogContent></Dialog>
}
