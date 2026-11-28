"use client"
import { useState } from 'react'
import { toast } from 'sonner'
import { demoShared } from '@/lib/api/demo-shared'
import { useApiQuery } from '@/hooks/use-api-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ErrorState } from '@/components/error-state'
import { UsageDailyChart, UsageFeatureBars } from './usage-charts'
import { UsageDetails, UsageInsights } from './usage-details'
import { usageOverview, overviewInsights, formatUsageTime, VIEW_EVENTS, ACTION_EVENTS } from '@/lib/usage-insights'
import { groupProductionUsage, type UsageGrouping } from '@/lib/production-usage'
import type { ProductionUsageTenant } from '@shared/types'

const selectClass='min-h-11 w-full rounded-md border bg-background px-3 text-sm'
export function ProductionUsage({platform}:{platform:boolean}) {
 const state=useApiQuery(demoShared.productionUsage,[],'本番顧客の利用状況を取得できませんでした')
 const [period,setPeriod]=useState(30),[grouping,setGrouping]=useState<UsageGrouping>('customer'),[agency,setAgency]=useState('all'),[query,setQuery]=useState(''),[selected,setSelected]=useState<string>(),[assigning,setAssigning]=useState(false)
 if(state.loading)return <p role="status">本番顧客の利用状況を集計しています…</p>
 if(state.error)return <ErrorState message={state.error} onRetry={state.reload}/>
 if(!state.data)return null
 const report=state.data,now=Date.parse(report.generatedAt??new Date().toISOString())
 const scoped={...report,accounts:report.accounts.filter(a=>agency==='all'||(a.agencyId??'unassigned')===agency)}
 const grouped=groupProductionUsage(scoped,grouping),model=usageOverview(grouped,period,now)
 const raw=usageOverview(scoped,period,now)
 const agencies=[...new Map(report.accounts.map(a=>[a.agencyId??'unassigned',a.agencyName??'未割り当て'])).entries()]
 const rows=model.accounts.filter(a=>`${a.name} ${a.email??''} ${a.tenantName??''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.total-a.total)
 const users=new Set(raw.accounts.filter(a=>a.total>0&&a.userId).map(a=>a.userId)).size
 return <div className="min-w-0 space-y-6">
  <div className="flex flex-wrap gap-2"><div role="group" aria-label="本番の集計期間" className="flex gap-2">{[7,30,90].map(n=><Button key={n} variant={period===n?'default':'outline'} aria-pressed={period===n} onClick={()=>setPeriod(n)}>直近{n}日</Button>)}</div><Button variant="ghost" onClick={state.reload}>最新に更新</Button>{platform&&<Button variant="outline" onClick={()=>setAssigning(true)}>本番顧客の担当を設定</Button>}</div>
  <p className="text-xs leading-6 text-muted-foreground">対象：{platform?'本番の契約顧客全体':'自社に割り当てられた本番顧客のみ'}。トライアルは含みません。ログイン利用者・所属顧客・ホテルをサーバーで確認した操作記録です。<br/>集計時点：{formatUsageTime(report.generatedAt)}（日本時間）。同じIDを共用すると個人は区別できません。</p>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['利用した顧客',new Set(raw.accounts.filter(a=>a.total>0).map(a=>a.tenantId)).size,'社'],['利用した利用者',users,'人'],['画面閲覧',raw.views,'回'],['操作完了',raw.actions,'回']].map(([label,value,unit])=><div key={label} className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{value}<span className="ml-2 text-xs font-normal">{unit}</span></p></div>)}</div>
  <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-2 text-sm">集計単位<select aria-label="本番の集計単位" className={selectClass} value={grouping} onChange={e=>{setGrouping(e.target.value as UsageGrouping);setSelected(undefined)}}><option value="customer">顧客別</option><option value="user">利用者別</option><option value="agency">代理店別</option></select></label>{platform&&<label className="grid gap-2 text-sm">担当代理店<select aria-label="本番の代理店で絞り込む" className={selectClass} value={agency} onChange={e=>{setAgency(e.target.value);setSelected(undefined)}}><option value="all">すべて</option>{agencies.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}<label className="grid gap-2 text-sm">一覧を検索<Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="名称・利用者メールで検索"/></label></div>
  <UsageDailyChart days={model.daily}/>
  <div className="grid gap-6 md:grid-cols-2"><section className="space-y-4"><h2 className="font-semibold">機能別の閲覧回数</h2><UsageFeatureBars counts={model.counts} events={VIEW_EVENTS}/></section><section className="space-y-4"><h2 className="font-semibold">機能別の完了回数</h2><UsageFeatureBars counts={model.counts} events={ACTION_EVENTS}/></section></div>
  <section className="space-y-4 border-t pt-5"><h2 className="font-semibold">記録から分かること</h2><UsageInsights items={overviewInsights(model,period)}/></section>
  <section className="space-y-3"><h2 className="font-semibold">{grouping==='user'?'利用者':grouping==='agency'?'代理店':'顧客'}別の利用状況</h2><p className="text-xs text-muted-foreground">選択すると、機能ごとの回数・最終操作日時・分析を表示します。</p><div className="divide-y rounded-lg border">{rows.map(a=><button key={a.id} className="grid w-full gap-3 p-4 text-left hover:underline focus-visible:outline sm:grid-cols-2" onClick={()=>setSelected(a.id)}><span className="min-w-0 break-words"><span className="font-medium">{a.name}</span>{grouping==='user'&&a.tenantName&&<span className="mt-1 block text-xs text-muted-foreground">{a.tenantName}</span>}{a.email&&<span className="mt-1 block break-all text-xs text-muted-foreground">{a.email}</span>}<span className="mt-2 block text-xs text-muted-foreground">最終操作：{formatUsageTime(a.last)}</span></span><span className="text-sm tabular-nums sm:text-right">{a.activeDays}日利用 · {a.views}回閲覧 · {a.actions}回完了</span></button>)}{!rows.length&&<p className="p-6 text-sm text-muted-foreground">対象の利用者はありません。顧客の担当割り当てと利用者登録を確認してください。</p>}</div></section>
  <p className="text-xs leading-6 text-muted-foreground">閲覧は画面を開いた回数、完了は保存・出力・回答完了の回数です。滞在時間・全クリック・入力内容・チャット本文は保存しません。利用者の権限変更や代理店の担当変更は次の取得時に反映されます。未記録だけで未利用や解約意向は判断しません。</p>
  <UsageDetails current={model.accounts.find(a=>a.id===selected)} data={grouped} period={period} now={now} onClose={()=>setSelected(undefined)}/>
  {assigning&&<ProductionAssignments onClose={()=>{setAssigning(false);state.reload()}}/>}
 </div>
}
function ProductionAssignments({onClose}:{onClose:()=>void}) {
 const tenants=useApiQuery(demoShared.productionTenants,[],'本番顧客を取得できませんでした'),agencies=useApiQuery(demoShared.agencies,[],'代理店を取得できませんでした')
 const [busy,setBusy]=useState(false),[choice,setChoice]=useState<{tenant:ProductionUsageTenant;agencyId:string|null}>()
 async function save(){if(!choice)return;setBusy(true);try{await demoShared.assignProductionTenant(choice.tenant.id,choice.agencyId);setChoice(undefined);tenants.reload();toast.success('担当代理店を変更しました')}catch(e){toast.error(e instanceof Error?e.message:'変更できませんでした')}finally{setBusy(false)}}
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>本番顧客の担当代理店</DialogTitle><DialogDescription>担当代理店には、選択した顧客の全ホテル・利用者の利用統計が表示されます。ホテルの業務データへのアクセス権限は付与しません。</DialogDescription></DialogHeader>{tenants.error?<ErrorState message={tenants.error} onRetry={tenants.reload}/>:agencies.error?<ErrorState message={agencies.error} onRetry={agencies.reload}/>:tenants.loading||agencies.loading?<p role="status">読み込んでいます…</p>:<div className="space-y-4">{tenants.data?.map(t=><label key={t.id} className="grid gap-2 text-sm">{t.name}{!t.isActive?'（停止中）':''}<select disabled={busy} aria-label={`${t.name}の担当代理店`} className={selectClass} value={choice?.tenant.id===t.id?choice.agencyId??'':t.agencyId??''} onChange={e=>setChoice({tenant:t,agencyId:e.target.value||null})}><option value="">全体管理者のみ</option>{agencies.data?.map(a=><option key={a.id} value={a.id} disabled={!a.active}>{a.name}{!a.active?'（停止中）':''}</option>)}</select></label>)}{!tenants.data?.length&&<p>本番顧客はまだ登録されていません。</p>}</div>}{choice&&<div className="space-y-3 border-t pt-4"><p className="text-sm">{choice.tenant.name}の担当を変更します。新しい担当は過去90日分の利用統計も閲覧できます。</p><Button disabled={busy} onClick={()=>void save()}>担当変更を確定</Button></div>}<Button variant="outline" disabled={busy} onClick={onClose}>閉じる</Button></DialogContent></Dialog>
}
