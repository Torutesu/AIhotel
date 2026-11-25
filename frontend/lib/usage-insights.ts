import { USAGE_EVENTS, USAGE_LABELS, type UsageAccount, type UsageReport, type UsageEvent } from '@shared/types/usage'

export const VIEW_EVENTS = USAGE_EVENTS.filter(e => e.startsWith('view_'))
export const ACTION_EVENTS = USAGE_EVENTS.filter(e => !e.startsWith('view_'))
const DAY = 86400000
export const jstDay = (at: number | string) => new Date((typeof at === 'string' ? new Date(at).getTime() : at) + 9 * 3600000).toISOString().slice(0, 10)
export const formatUsageTime = (at?: string | null) => at ? new Date(at).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' }) : '記録なし'
const countEvents = (counts: Partial<Record<UsageEvent, number>>, events: readonly UsageEvent[]) => events.reduce((sum,e)=>sum+(counts[e]??0),0)
export function usageAccount(account: UsageAccount, period: number, now: number) {
  const today = jstDay(now), cutoff = jstDay(now-(period-1)*DAY)
  const days = account.days.filter(d => d.day >= cutoff && d.day <= today)
  const counts = Object.fromEntries(USAGE_EVENTS.map(e=>[e,days.reduce((sum,d)=>sum+(d.counts[e]??0),0)])) as Record<UsageEvent,number>
  const last = account.days.filter(d=>d.day<=today && countEvents(d.counts,USAGE_EVENTS)>0).map(d=>d.lastAt).sort().at(-1)
  const idleDays = last ? Math.floor((Date.parse(today)-Date.parse(jstDay(last)))/DAY) : null
  const views=countEvents(counts,VIEW_EVENTS), actions=countEvents(counts,ACTION_EVENTS)
  const activeDays=days.filter(d=>countEvents(d.counts,USAGE_EVENTS)>0).length
  const lastByEvent = Object.fromEntries(USAGE_EVENTS.map(e=>[e,days.flatMap(d=>d.lastByEvent?.[e]?[d.lastByEvent[e]!]:[]).sort().at(-1)])) as Partial<Record<UsageEvent,string>>
  const timeline=days.flatMap(d=>d.events??[]).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,50)
  const unavailable=account.status==='SUSPENDED'||account.status==='EXPIRED'
  const needsFollowup=!unavailable && (idleDays===null || idleDays>=7)
  const statusLabel=account.status==='SUSPENDED'?'停止中':account.status==='EXPIRED'?'期限切れ':!last?(account.lastLoginAt===null?'未ログイン':'操作記録なし'):(idleDays ?? 0)>=7?'7日以上記録なし':actions===0&&views>0?'閲覧のみ':'利用記録あり'
  return {...account,days,counts,last,idleDays,views,actions,activeDays,lastByEvent,timeline,total:views+actions,needsFollowup,statusLabel}
}
export type UsageAccountSummary=ReturnType<typeof usageAccount>
export function usageOverview(report: UsageReport, period: number, now: number) {
  const accounts=report.accounts.map(a=>usageAccount(a,period,now))
  const today=jstDay(now)
  const earliest=report.startedAt ? jstDay(report.startedAt) : report.accounts.flatMap(a=>a.days.map(d=>d.day)).sort()[0]
  const daily=Array.from({length:period},(_,i)=>{
    const day=jstDay(now-(period-1-i)*DAY)
    const rows=accounts.flatMap(a=>a.days.filter(d=>d.day===day))
    return {day,label:day.slice(5).replace('-','/'),views:rows.reduce((s,d)=>s+countEvents(d.counts,VIEW_EVENTS),0),actions:rows.reduce((s,d)=>s+countEvents(d.counts,ACTION_EVENTS),0),accounts:rows.filter(d=>countEvents(d.counts,USAGE_EVENTS)>0).length,measured:!!earliest&&day>=earliest}
  })
  const counts=Object.fromEntries(USAGE_EVENTS.map(e=>[e,accounts.reduce((s,a)=>s+a.counts[e],0)])) as Record<UsageEvent,number>
  // Compare complete JST days only. Before observation started is not zero usage.
  const start=jstDay(now-14*DAY), split=jstDay(now-7*DAY)
  const canCompare=!!earliest && earliest<=start
  const sum=(from:string,to:string)=>report.accounts.reduce((sum,a)=>sum+a.days.filter(d=>d.day>=from&&d.day<to).reduce((s,d)=>s+countEvents(d.counts,USAGE_EVENTS),0),0)
  const comparison={available:canCompare,previous:sum(start,split),current:sum(split,today),start,split,end:jstDay(now-DAY)}
  return {accounts,daily,counts,comparison,active:accounts.filter(a=>a.total>0).length,completed:accounts.filter(a=>a.actions>0).length,followup:accounts.filter(a=>a.needsFollowup).length,views:countEvents(counts,VIEW_EVENTS),actions:countEvents(counts,ACTION_EVENTS)}
}
export interface UsageInsight { title: string; text: string; next?: string }
export function accountInsights(a: UsageAccountSummary, source: UsageReport['source']): UsageInsight[] {
  if(!a.total) return [{title:'この期間の操作記録はありません',text:a.last?`保持している記録の最終操作は${formatUsageTime(a.last)}です。`:'計測開始後、操作はまだ記録されていません。',next:a.status==='EXPIRED'||a.status==='SUSPENDED'?'利用期限・停止状態を確認してから案内してください。':'未利用とは断定せず、ログイン案内が届いているか、計測できているかを確認してください。'}]
  const top=VIEW_EVENTS.filter(e=>a.counts[e]>0).sort((x,y)=>a.counts[y]-a.counts[x])[0]
  const result:UsageInsight[]=[{title:`${a.activeDays}日間の利用記録`,text:`画面閲覧${a.views}回、操作完了${a.actions}回。${top?`最も閲覧されているのは「${USAGE_LABELS[top].replace('閲覧','')}」の${a.counts[top]}回です。`:'画面閲覧の記録はありません。'}`}]
  if(a.counts.view_pricing>0&&!a.counts.pricing_saved) result.push({title:'料金設定は閲覧までを確認',text:`料金設定を${a.counts.view_pricing}回閲覧していますが、保存完了の記録はありません。`,next:'確認だけで完了したのか、設定方法の案内が必要かをヒアリングしてください。'})
  else if(a.actions>0) result.push({title:'操作完了まで利用されています',text:ACTION_EVENTS.filter(e=>a.counts[e]>0).map(e=>`${USAGE_LABELS[e]} ${a.counts[e]}回`).join('、')+'。',next:'よく使う業務と、追加で必要な機能を確認する材料にできます。'})
  if(source==='trial'&&a.counts.view_reports>0) result.push({title:'デモの出力制限を考慮',text:'公開デモではレポート出力が未提供です。出力0回を操作のつまずきや未活用の根拠にはしません。'})
  else if(a.needsFollowup) result.push({title:'直近の利用状況を確認',text:`保持している記録では${a.idleDays}日間、新しい操作がありません。`,next:'休業・業務頻度・アカウント共有などの事情を確認してからフォローしてください。'})
  return result.slice(0,3)
}
export function overviewInsights(model: ReturnType<typeof usageOverview>, period: number): UsageInsight[] {
  if(!model.accounts.length) return [{title:'対象のアカウントがありません',text:'担当トライアルの割り当て後、実際の利用が始まると集計されます。'}]
  const results:UsageInsight[]=[{title:`${model.accounts.length}件中${model.active}件に利用記録`,text:`直近${period}日で、画面閲覧${model.views}回・操作完了${model.actions}回が記録されています。操作完了があるのは${model.completed}件です。`}]
  if(model.followup) results.push({title:`${model.followup}件は利用状況の確認候補`,text:'利用可能なアカウントのうち、7日以上新しい操作がない、または操作記録がまだないものです。',next:'「フォロー候補」で絞り込み、最終ログインや期限と合わせて確認してください。未利用・解約意向の断定ではありません。'})
  const {comparison:c}=model
  results.push(c.available?{title:'完了した7日間どうしの比較',text:`${c.start}〜${jstDay(Date.parse(c.split+'T00:00:00+09:00')-DAY)}は${c.previous}回、${c.split}〜${c.end}は${c.current}回。${c.previous?(c.current===c.previous?'閲覧・操作の合計は同数です。':`閲覧・操作の合計は${Math.abs(Math.round((c.current-c.previous)/c.previous*1000)/10)}%${c.current>c.previous?'増加':'減少'}しています。`):'前の期間が0回のため、増減率は計算しません。'} 今日の途中経過は含みません。対象アカウント数の変化も含む比較です。`}:{title:'週ごとの比較は計測が揃ってから',text:'今日を除く14日分の計測期間がまだ揃っていないため、増減率は表示しません。計測開始前を0回として扱うことはありません。'})
  return results
}
