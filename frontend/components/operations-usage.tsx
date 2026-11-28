"use client"
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useApiQuery } from '@/hooks/use-api-query'
import { getUsageReport } from '@/lib/api/usage'
import { ErrorState } from '@/components/error-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UsageDailyChart, UsageFeatureBars } from '@/components/operations/usage-charts'
import { UsageDetails, UsageInsights } from '@/components/operations/usage-details'
import { VIEW_EVENTS, overviewInsights, usageOverview, formatUsageTime } from '@/lib/usage-insights'

export function OperationsUsage({ scope = 'all' }: { scope?: 'all' | 'assigned' }) {
  const {data,loading,error,reload}=useApiQuery(getUsageReport,[],'活用状況を取得できませんでした')
  const [period,setPeriod]=useState(30), [query,setQuery]=useState(''), [filter,setFilter]=useState('all'), [sort,setSort]=useState('recent')
  const [selected,setSelected]=useState<string|null>(null)
  if(loading) return <p role="status">活用状況を集計しています…</p>
  if(error) return <ErrorState message={error} onRetry={reload}/>
  if(!data) return null
  const now=data.generatedAt?Date.parse(data.generatedAt):Date.now()
  const model=usageOverview(data,period,now)
  const filtered=model.accounts.filter(a=>`${a.name} ${a.email??''}`.toLowerCase().includes(query.trim().toLowerCase())&&(filter==='all'||(filter==='awaiting'?a.statusLabel==='利用開始待ち':filter==='followup'?a.needsFollowup:filter==='readOnly'?a.views>0&&a.actions===0:filter==='active'?a.total>0:a.lastLoginAt===null)))
    .sort((a,b)=>sort==='volume'?b.total-a.total:sort==='name'?a.name.localeCompare(b.name,'ja'):(b.last??'').localeCompare(a.last??''))
  const current=filtered.find(a=>a.id===selected)
  const selectClass='min-h-11 rounded-md border bg-background px-3 text-sm'
  const date=(at:string)=>new Date(at).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'})
  return <div className="min-w-0 space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="集計期間" className="flex gap-2">{[7,30,90].map(n=><Button key={n} variant={period===n?'default':'outline'} aria-pressed={period===n} onClick={()=>setPeriod(n)}>直近{n}日</Button>)}</div>
      <Button variant="ghost" onClick={()=>void reload()}>最新に更新</Button>
    </div>
    <p className="text-xs leading-6 text-muted-foreground">{scope==='assigned'?'対象：自社に割り当てられたアカウントのみ。':'対象：全体管理者が管理するアカウント。'} {data.source==='trial'?'トライアルの実際の操作をアカウント単位の集計で表示します。ホテル業務データ自体はサンプルです。':'ホテル単位の実際の利用記録です。'}<br/>集計時点：{formatUsageTime(new Date(now).toISOString())}。日付・日時は日本時間です。計測開始：{data.startedAt?date(data.startedAt):'初回の記録待ち'}。</p>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      {label:'期間内に利用',value:model.active,unit:`/ ${model.accounts.length}件`,note:'1回以上の閲覧・操作記録'},
      {label:'操作完了まで利用',value:model.completed,unit:'件',note:'保存・出力・チャット回答の完了'},
      {label:'画面閲覧',value:model.views,unit:'回',note:'対象アカウントの閲覧合計'},
      {label:'フォロー候補',value:model.followup,unit:'件',note:'7日以上記録なし・発行後7日以上未記録'},
    ].map(m=><div key={m.label} className="min-w-0 rounded-lg border p-4 sm:p-5"><p className="text-xs leading-5 text-muted-foreground">{m.label}</p><p className="mt-3 text-3xl font-semibold tabular-nums">{m.value.toLocaleString()}<span className="ml-2 text-xs font-normal text-muted-foreground">{m.unit}</span></p><p className="mt-3 text-xs leading-5 text-muted-foreground">{m.note}</p></div>)}</div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section className="min-w-0 rounded-lg border p-4 sm:p-6"><UsageDailyChart days={model.daily}/></section>
      <section className="min-w-0 space-y-5 rounded-lg border p-4 sm:p-6"><h2 className="text-sm font-semibold">どの画面が使われているか</h2><UsageFeatureBars counts={model.counts} events={VIEW_EVENTS}/><p className="text-xs leading-5 text-muted-foreground">期間内の画面閲覧回数。棒の長さは、この中の最大値を基準にしています。</p></section>
    </div>
    <section className="space-y-5 rounded-lg border p-4 sm:p-6" aria-label="利用記録の分析">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">利用記録から分かること</h2><p className="text-xs text-muted-foreground">集計値から自動作成</p></div>
      <UsageInsights items={overviewInsights(model,period)}/>
    </section>
    <section className="space-y-4" aria-label="顧客別の利用状況">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">顧客別に確認</h2><p className="text-xs text-muted-foreground">{filtered.length}件を表示 · 選択すると詳細を表示</p></div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Input aria-label="活用状況の顧客を検索" placeholder="顧客名・メールで検索" value={query} onChange={e=>setQuery(e.target.value)}/>
        <select aria-label="利用状況で絞り込む" className={selectClass} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">すべて</option><option value="awaiting">利用開始待ち</option><option value="followup">フォロー候補</option><option value="active">期間内に利用</option><option value="readOnly">期間内は閲覧のみ</option>{data.source==='trial'&&<option value="noLogin">未ログイン</option>}</select>
        <select aria-label="顧客の並び順" className={selectClass} value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">最終操作が新しい順</option><option value="volume">閲覧・操作が多い順</option><option value="name">顧客名順</option></select>
      </div>
      <div className="divide-y rounded-lg border">{filtered.map(a=><button key={a.id} aria-haspopup="dialog" onClick={()=>setSelected(a.id)} className="group grid w-full gap-4 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:grid-cols-[minmax(0,1fr)_220px_20px] sm:items-center sm:p-5">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="break-words text-sm font-semibold group-hover:underline underline-offset-4">{a.name}</span><span className="rounded border px-2 py-1 text-[11px] text-muted-foreground">{a.statusLabel}</span></div><p className="mt-2 text-xs leading-6 text-muted-foreground">最終操作：{formatUsageTime(a.last)}{a.expiresAt&&` · 利用期限：${date(a.expiresAt)}`}</p></div>
        <div className="flex justify-between gap-4 text-sm tabular-nums sm:justify-end"><span>{a.activeDays}<small className="ml-1 text-muted-foreground">日利用</small></span><span>{a.views}<small className="ml-1 text-muted-foreground">閲覧</small></span><span>{a.actions}<small className="ml-1 text-muted-foreground">完了</small></span></div><ChevronRight className="hidden size-4 text-muted-foreground sm:block" aria-hidden/>
      </button>)}{!filtered.length&&<p className="p-8 text-center text-sm text-muted-foreground">該当する顧客はありません。</p>}</div>
    </section>
    <details className="text-xs leading-6 text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 underline underline-offset-4">計測の範囲と読み方</summary><p>閲覧は画面を開いた回数、完了は操作が成功した回数です。滞在時間・個人単位の行動・クリック全件は計測していません。未記録は未利用の断定ではありません。チャット本文や入力内容は保存しません。集計は直近90日を表示します。顧客台帳とは別に、割り当てられたトライアルを集計しています。</p></details>
    <UsageDetails current={current} data={data} period={period} now={now} onClose={()=>setSelected(null)}/>
  </div>
}
