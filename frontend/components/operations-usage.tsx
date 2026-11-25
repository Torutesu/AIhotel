"use client"
import { useState } from 'react'
import { USAGE_EVENTS, USAGE_LABELS } from '@shared/types/usage'
import { useApiQuery } from '@/hooks/use-api-query'
import { getUsageReport } from '@/lib/api/usage'
import { ErrorState } from '@/components/error-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function OperationsUsage() {
  const { data, loading, error, reload } = useApiQuery(getUsageReport, [], '活用状況を取得できませんでした')
  const [period, setPeriod] = useState(30)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  if (loading) return <p role="status">活用状況を集計しています…</p>
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null
  const cutoff = new Date(Date.now() + 9 * 3600000 - (period - 1) * 86400000).toISOString().slice(0, 10)
  const rows = data.accounts.map(a => {
    const days = a.days.filter(d => d.day >= cutoff)
    const counts = Object.fromEntries(USAGE_EVENTS.map(e => [e, days.reduce((s, d) => s + (d.counts[e] ?? 0), 0)]))
    const last = a.days.map(d => d.lastAt).sort().at(-1)
    return { ...a, days, counts, last, total: Object.values(counts).reduce((s, n) => s + n, 0) }
  })
  const current = rows.find(a => a.id === selected && a.name.toLowerCase().includes(query.toLowerCase()))
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2">{[7, 30, 90].map(n => <Button key={n} variant={period === n ? 'default' : 'outline'} aria-pressed={period === n} onClick={() => setPeriod(n)}>直近{n}日</Button>)}</div><Button variant="ghost" onClick={() => void reload()}>最新に更新</Button></div>
    <p className="text-xs leading-6 text-muted-foreground">{data.source === 'trial' ? '対象：外部配布トライアルの実際の操作。アカウント単位の集計です（ホテル業務データ自体はサンプル）' : '対象：顧客の実際の操作。ホテル単位の集計です'}<br />{data.startedAt ? `計測開始：${new Date(data.startedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}。それ以前の利用履歴は含みません。` : '計測は導入済みです。初回の利用操作を待っています。'} 日付・日時は日本時間です。記録するのは操作種別と回数で、チャット本文や入力内容は保存しません。</p>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      ['期間内に利用', `${rows.filter(a => a.total > 0).length}件`], ['操作の記録なし', `${rows.filter(a => a.total === 0).length}件`], ['チャット回答完了', `${rows.reduce((s, a) => s + a.counts.chat_completed, 0)}回`], ['レポート出力完了', `${rows.reduce((s, a) => s + a.counts.report_exported, 0)}回`],
    ].map(([label, value]) => <div key={label} className="rounded-lg border p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
    <Input aria-label="活用状況の顧客を検索" placeholder="顧客名で検索" value={query} onChange={e => setQuery(e.target.value)} className="sm:max-w-sm" />
    <div className="space-y-3">{rows.filter(a => a.name.toLowerCase().includes(query.toLowerCase())).map(a => <button key={a.id} aria-expanded={selected === a.id} onClick={() => setSelected(selected === a.id ? null : a.id)} className="w-full rounded-lg border p-5 text-left hover:border-foreground focus-visible:outline focus-visible:outline-2"><div className="flex flex-wrap justify-between gap-3"><span className="font-medium">{a.name}</span><span className="text-sm">{a.days.length}日利用 · {a.total}回の閲覧・操作</span></div><p className="mt-2 text-xs leading-6 text-muted-foreground">{a.last ? `最終操作：${new Date(a.last).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : '計測開始後の操作は未記録'}<span className="ml-3 underline">機能別の内訳を見る</span></p></button>)}{!rows.some(a => a.name.toLowerCase().includes(query.toLowerCase())) && <p className="p-5 text-sm text-muted-foreground">該当する顧客はありません。</p>}</div>
    {current && <section className="space-y-4 rounded-lg border p-5"><h2 className="font-semibold">{current.name}の活用状況</h2><p className="text-xs leading-6 text-muted-foreground">閲覧は画面を開いた回数、完了は操作が成功した回数です。未記録は未利用の断定ではありません。</p><dl className="divide-y">{USAGE_EVENTS.map(e => <div key={e} className="flex justify-between gap-4 py-3 text-sm"><dt>{USAGE_LABELS[e]}</dt><dd className="tabular-nums">{current.counts[e]}回</dd></div>)}</dl><h3 className="text-sm font-medium">日別の記録</h3>{current.days.length ? current.days.slice().sort((a,b) => b.day.localeCompare(a.day)).map(d => <div key={d.day} className="flex justify-between text-sm"><span>{d.day}</span><span>{Object.values(d.counts).reduce((s,n) => s + n, 0)}回</span></div>) : <p className="text-sm text-muted-foreground">この期間の操作は記録されていません。</p>}</section>}
  </div>
}
