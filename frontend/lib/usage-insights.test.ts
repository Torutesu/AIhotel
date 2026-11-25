import { describe, expect, it } from 'vitest'
import { accountInsights, overviewInsights, usageAccount, usageOverview } from './usage-insights'
import type { UsageReport } from '@shared/types/usage'
const now=Date.parse('2026-11-25T01:00:00Z')
const report:UsageReport={source:'trial',startedAt:'2026-11-01T00:00:00Z',accounts:[{id:'a',name:'A',status:'ACTIVE',lastLoginAt:'2026-11-25T00:00:00Z',days:[
 {day:'2026-11-18',counts:{view_dashboard:100},lastAt:'2026-11-18T01:00:00Z'},
 {day:'2026-11-19',counts:{view_pricing:3,chat_completed:2},lastAt:'2026-11-19T01:00:00Z'},
 {day:'2026-11-25',counts:{view_analysis:4},lastAt:'2026-11-25T01:00:00Z'},
 {day:'2026-11-26',counts:{chat_completed:999},lastAt:'2026-11-26T01:00:00Z'},
]}]}
describe('usage analysis: measured data only',()=>{
 it('uses seven inclusive JST dates and separates views from completions',()=>{
  const m=usageOverview(report,7,now)
  expect(m.daily).toHaveLength(7)
  expect(m.daily[0].day).toBe('2026-11-19')
  expect(m.views).toBe(7);expect(m.actions).toBe(2)
  expect(m.accounts[0].activeDays).toBe(2)
  expect(m.accounts[0].last).toBe('2026-11-25T01:00:00Z')
 })
 it('does not convert unobserved history to zero or claim a weekly trend',()=>{
  const m=usageOverview({...report,startedAt:'2026-11-25T00:00:00Z',accounts:[]},30,now)
  expect(m.daily.filter(d=>d.measured)).toHaveLength(1)
  expect(m.comparison.available).toBe(false)
  const insights=overviewInsights(usageOverview({...report,startedAt:'2026-11-25T00:00:00Z'},30,now),30)
  expect(insights.at(-1)?.text).toContain('増減率は表示しません')
 })
 it('compares complete days only and handles zero baseline',()=>{
  const m=usageOverview(report,30,now)
  expect(m.comparison.current).toBe(105)
  expect(m.comparison.previous).toBe(0)
  expect(overviewInsights(m,30).at(-1)?.text).toContain('増減率は計算しません')
 })
 it('excludes suspended/expired accounts from followup and does not imply churn',()=>{
  const days=[{day:'2026-11-10',counts:{view_analysis:1},lastAt:'2026-11-10T01:00:00Z'}]
  const a=usageAccount({id:'a',name:'A',status:'ACTIVE',days},7,now)
  expect(a.needsFollowup).toBe(true);expect(a.statusLabel).toBe('7日以上記録なし')
  expect(usageAccount({...a,status:'EXPIRED'},7,now).needsFollowup).toBe(false)
  expect(accountInsights(a,'trial')[0].next).toContain('未利用とは断定せず')
 })
 it('does not fabricate event times for legacy counts or treat demo export as a failure',()=>{
  const a=usageAccount({id:'a',name:'A',days:[{day:'2026-11-25',counts:{view_reports:5},lastAt:'2026-11-25T01:00:00Z'}]},7,now)
  expect(a.timeline).toEqual([]);expect(a.lastByEvent.view_reports).toBeUndefined()
  expect(accountInsights(a,'trial').some(i=>i.text.includes('出力0回を操作のつまずき'))).toBe(true)
 })
 it('keeps event-specific times and chronological detail independent of total counts',()=>{
  const a=usageAccount({id:'a',name:'A',days:[{day:'2026-11-25',counts:{view_analysis:7},lastAt:'2026-11-25T01:00:00Z',lastByEvent:{view_analysis:'2026-11-25T01:00:00Z'},events:[{event:'view_analysis',at:'2026-11-25T00:00:00Z'},{event:'view_analysis',at:'2026-11-25T01:00:00Z'}]}]},7,now)
  expect(a.total).toBe(7);expect(a.timeline).toHaveLength(2)
  expect(a.timeline[0].at).toBe(a.lastByEvent.view_analysis)
 })
})
