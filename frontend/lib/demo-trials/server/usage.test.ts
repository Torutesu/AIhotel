import { describe, it, expect, vi, afterEach } from 'vitest'
import { memoryKv } from './kv'
import { adminLogin, createTrial, trialLogin } from './service'
import { recordUsage, usageReport } from './usage'
afterEach(() => vi.unstubAllEnvs())
describe('活用状況の共有計測', () => {
  it('未認証は書き込めない', async () => {
    await expect(recordUsage(memoryKv(), undefined, 'view_analysis')).rejects.toMatchObject({ status: 401 })
  })
  it('署名済みの本人にだけ集計し、並行操作でも回数を失わない', async () => {
    vi.stubEnv("DEMO_PUBLIC_URL", "https://example.test")
    vi.stubEnv("DEMO_TRIAL_CREDENTIALS_KEY", "ab".repeat(32))
    const kv = memoryKv()
    await adminLogin(kv, 'test-usage-password-1', null)
    const trial = await createTrial(kv, { name: '計測テスト', kind: 'PROSPECT_HOTEL', days: 30 })
    const login = await trialLogin(kv, trial.trial.loginEmail!, trial.password, null)
    await Promise.all(Array.from({length: 4}, () => recordUsage(kv, login!.cookie, 'view_analysis')))
    await recordUsage(kv, login!.cookie, 'chat_completed')
    await expect(recordUsage(kv, login!.cookie, 'arbitrary')).rejects.toMatchObject({status:400})
    const report = await usageReport(kv)
    expect(report.accounts[0].days[0].counts).toEqual({view_analysis:4,chat_completed:1})
    expect(report.startedAt).toBeTruthy()
    expect(report.accounts[0].id).toBe(trial.trial.id)
  })
})

describe('時刻付きの操作記録',()=>{
  it('本文を保持せず日別回数と機能別最終時刻を維持し、直近履歴だけを返す',async()=>{
    vi.stubEnv('DEMO_PUBLIC_URL','https://example.test');vi.stubEnv('DEMO_TRIAL_CREDENTIALS_KEY','ab'.repeat(32))
    const kv=memoryKv()
    await adminLogin(kv,'test-usage-password-2',null)
    const issued=await createTrial(kv,{name:'時刻テスト',kind:'PROSPECT_HOTEL'})
    const login=await trialLogin(kv,issued.trial.loginEmail!,issued.password,null)
    const base=Date.now()
    for(let i=0;i<35;i++)await recordUsage(kv,login!.cookie,i===0?'chat_completed':'view_analysis',base+i)
    const report=await usageReport(kv)
    const account=report.accounts[0],day=account.days[0]
    expect(day.counts).toEqual({chat_completed:1,view_analysis:34})
    expect(day.events).toHaveLength(30)
    expect(day.lastByEvent?.chat_completed).toBe(new Date(base).toISOString())
    expect(day.lastByEvent?.view_analysis).toBe(new Date(base+34).toISOString())
    expect(Object.keys(day.events![0]).sort()).toEqual(['at','event'])
    expect(account.email).toBe(issued.trial.loginEmail)
    expect(account.status).toBe('ACTIVE')
    expect(report.generatedAt).toBeTruthy()
  })
})
