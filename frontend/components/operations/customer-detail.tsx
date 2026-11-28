"use client"
import { demoShared } from '@/lib/api/demo-shared'
import { useApiQuery } from '@/hooks/use-api-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ErrorState } from '@/components/error-state'
import { UsageDailyChart } from './usage-charts'
import { UsageInsights } from './usage-details'
import { usageOverview, overviewInsights, formatUsageTime } from '@/lib/usage-insights'
export function CustomerDetail({id,onClose}:{id:string;onClose:()=>void}) {
 const state=useApiQuery(()=>demoShared.customerDetail(id),[id],'顧客詳細を取得できませんでした')
 const data=state.data
 const model=data?usageOverview(data.report,30,Date.now()):null
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle>{data?.customer.name??'顧客詳細'}</DialogTitle><DialogDescription>契約状況・担当トライアル・直近30日の活用状況</DialogDescription></DialogHeader>{state.error?<ErrorState message={state.error} onRetry={state.reload}/>:!data||!model?<p role="status">読み込んでいます…</p>:<div className="space-y-6"><p className="text-sm">契約状況（手動管理）：{{UNCONFIRMED:'未確認',TRIAL:'トライアル中',ACTIVE:'契約中',ENDED:'終了'}[data.customer.contractStatus??'UNCONFIRMED']}</p><section><h3 className="font-medium">関連トライアル</h3>{data.trials.length?<ul className="divide-y">{data.trials.map(t=><li key={t.id} className="py-3 text-sm break-words">{t.name} · {{ACTIVE:'利用可能',EXPIRED:'期限切れ',SUSPENDED:'停止中'}[t.status]} · 期限 {formatUsageTime(t.expiresAt)}</li>)}</ul>:<p className="mt-2 text-sm text-muted-foreground">関連付けられた閲覧可能なトライアルはありません。「編集」から指定できます。</p>}</section>{data.trials.length>0&&<><UsageDailyChart days={model.daily}/><UsageInsights items={overviewInsights(model,30)}/></>}<section><h3 className="font-medium">対応履歴</h3><p className="mt-2 text-xs text-muted-foreground">手動で記録した最新100件。操作監査ログとは別の記録です。</p>{data.customer.history?.length?<ol className="divide-y">{[...data.customer.history].reverse().map((h,i)=><li key={i} className="py-3 text-sm"><time className="text-muted-foreground">{formatUsageTime(h.at)}</time><p className="mt-2 whitespace-pre-wrap break-words">{h.text}</p></li>)}</ol>:<p className="mt-2 text-sm text-muted-foreground">対応履歴はまだありません。</p>}</section></div>}</DialogContent></Dialog>
}
