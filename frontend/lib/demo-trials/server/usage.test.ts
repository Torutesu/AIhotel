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
