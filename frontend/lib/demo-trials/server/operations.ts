import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AgencyAccount, OperationsCustomer, OperationsIdentity } from '@/lib/operations-types'
import { DemoTrialError, LOGIN_FAILED_MESSAGE, randomPassword } from '../core'
import type { DemoKv } from './kv'
import { ADMIN_SESSION_SECONDS, hashPassword, verifyAdminSession, verifyPassword } from './service'

type Account = AgencyAccount & { passwordHash: string; signingKey: string }
const ACCOUNTS = 'operations:accounts'
const CUSTOMERS = 'operations:customers'
const dummyPasswordHash = hashPassword(randomBytes(32).toString('hex'))
export const platformIdentity = (): OperationsIdentity => ({ id: 'platform', role: 'PLATFORM_ADMIN', name: '全体管理者', email: process.env.DEMO_ADMIN_EMAIL ?? '' })
function signature(account: Account, exp: string) { return createHmac('sha256', account.signingKey).update(`agency:${account.id}:${exp}`).digest('base64url') }
function same(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
async function accounts(kv: DemoKv): Promise<Account[]> { return Object.values(await kv.hgetall(ACCOUNTS)).map(v => JSON.parse(v)) }
function publicAccount(a: Account): AgencyAccount { return { id: a.id, name: a.name, email: a.email, active: a.active, createdAt: a.createdAt } }
export function requirePlatform(actor: OperationsIdentity) { if (actor.role !== 'PLATFORM_ADMIN') throw new DemoTrialError(403, '全体管理者のみ操作できます') }
export function canAccess(actor: OperationsIdentity, agencyId?: string | null) { return actor.role === 'PLATFORM_ADMIN' || agencyId === actor.id }
export async function operationsSession(kv: DemoKv, cookie?: string): Promise<OperationsIdentity | null> {
  if (await verifyAdminSession(kv, cookie)) return platformIdentity()
  const [prefix, id, exp, sig, extra] = cookie?.split('.') ?? []
  if (prefix !== 'agency' || !id || !exp || !sig || extra || !Number.isFinite(Number(exp)) || Number(exp) * 1000 <= Date.now()) return null
  const account = (await accounts(kv)).find(a => a.id === id)
  if (!account?.active || !same(sig, signature(account, exp))) return null
  return { id, role: 'AGENCY', name: account.name, email: account.email }
}
export async function agencyLogin(kv: DemoKv, email: string, password: string, ip: string | null) {
  const key = `operations:login:${ip ?? 'unknown'}`
  if (Number(await kv.get(key) ?? 0) >= 10) throw new DemoTrialError(429, 'ログインの失敗が続いています。15分後にお試しください')
  const account = (await accounts(kv)).find(a => a.email === email)
  // Equal-cost comparison for unknown accounts; never reveal whether an email exists.
  const hash = account?.passwordHash ?? await dummyPasswordHash
  const valid = await verifyPassword(password, hash)
  if (!account?.active || !valid) { await kv.incrWithTtl(key, 900); throw new DemoTrialError(401, LOGIN_FAILED_MESSAGE) }
  const exp = String(Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS)
  return { cookie: `agency.${account.id}.${exp}.${signature(account, exp)}`, identity: { id: account.id, role: 'AGENCY' as const, name: account.name, email: account.email } }
}
function field(input: Record<string, unknown>, key: string, max = 200, required = false) {
  const value = input[key] === undefined ? '' : input[key]
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new DemoTrialError(400, '入力内容を確認してください')
  return value.trim()
}
export async function listAgencies(kv: DemoKv, actor: OperationsIdentity) { requirePlatform(actor); return (await accounts(kv)).map(publicAccount) }
export async function createAgency(kv: DemoKv, actor: OperationsIdentity, input: Record<string, unknown>) {
  requirePlatform(actor)
  const name = field(input, 'name', 100, true), email = field(input, 'email', 200, true).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase()) throw new DemoTrialError(400, '別の有効なメールアドレスを指定してください')
  // Reserve the normalized address atomically; concurrent issuance must not create duplicate logins.
  const id = randomBytes(12).toString('hex')
  if (!await kv.setIfAbsent(`operations:email:${email}`, id)) throw new DemoTrialError(409, 'このメールアドレスは登録済みです')
  const password = randomPassword() + randomPassword().slice(0, 4)
  const account: Account = { id, name, email, active: true, createdAt: new Date().toISOString(), passwordHash: await hashPassword(password), signingKey: randomBytes(32).toString('hex') }
  await kv.hset(ACCOUNTS, id, JSON.stringify(account))
  return { account: publicAccount(account), password }
}
export async function updateAgency(kv: DemoKv, actor: OperationsIdentity, id: string, input: Record<string, unknown>) {
  requirePlatform(actor)
  const before = (await kv.hgetall(ACCOUNTS))[id]
  const account = before ? JSON.parse(before) as Account : undefined
  if (!account) throw new DemoTrialError(404, '代理店が見つかりません')
  if (typeof input.active === 'boolean') { account.active = input.active; account.signingKey = randomBytes(32).toString('hex') }
  if (input.name !== undefined) account.name = field(input, 'name', 100, true)
  let password: string | undefined
  if (input.resetPassword === true) { password = randomPassword() + randomPassword().slice(0, 4); account.passwordHash = await hashPassword(password); account.signingKey = randomBytes(32).toString('hex') }
  if (!await kv.hashCompareAndSet(ACCOUNTS, id, before, JSON.stringify(account))) throw new DemoTrialError(409, '別の管理者が更新しました。最新の状態を確認してから再操作してください')
  return { account: publicAccount(account), ...(password ? { password } : {}) }
}
export async function validateAgency(kv: DemoKv, id: unknown): Promise<string | null> {
  if (id === null || id === undefined || id === '') return null
  if (typeof id !== 'string' || !(await accounts(kv)).some(a => a.id === id && a.active)) throw new DemoTrialError(400, '有効な代理店を選択してください')
  return id
}
export async function listCustomers(kv: DemoKv, actor: OperationsIdentity): Promise<OperationsCustomer[]> {
  const [records, owners] = await Promise.all([kv.hgetall(CUSTOMERS), kv.hgetall('operations:customer-owners')])
  const all = Object.values(records).map(v => {
    const c = JSON.parse(v) as OperationsCustomer
    return { ...c, agencyId: Object.hasOwn(owners, c.id) ? owners[c.id] || null : c.agencyId }
  })
  return all.filter(c => canAccess(actor, c.agencyId))
}
export async function saveCustomer(kv: DemoKv, actor: OperationsIdentity, input: Record<string, unknown>, id?: string) {
  const existing = id ? (await listCustomers(kv, actor)).find(c => c.id === id) : undefined
  if (id && !existing) throw new DemoTrialError(404, '顧客が見つかりません')
  const agencyId = actor.role === 'AGENCY' ? actor.id : await validateAgency(kv, input.agencyId === undefined ? existing?.agencyId : input.agencyId)
  const merged = { ...existing, ...input }
  const trialIds = merged.trialIds ?? []
  if (!Array.isArray(trialIds) || trialIds.length > 50 || trialIds.some(t => typeof t !== 'string')) throw new DemoTrialError(400, 'トライアルの選択を確認してください')
  const { listTrials } = await import('./service')
  const allowed = await listTrials(kv, Date.now(), actor)
  if (trialIds.some(id => !allowed.some(t => t.id === id && (t.agencyId ?? null) === agencyId))) throw new DemoTrialError(400, '担当代理店が同じトライアルのみ関連付けできます。担当変更時は関連付けを解除してください')
  const contractStatus = merged.contractStatus ?? 'UNCONFIRMED'
  if (!['UNCONFIRMED','TRIAL','ACTIVE','ENDED'].includes(String(contractStatus))) throw new DemoTrialError(400, '契約状況を確認してください')
  const activity = field(input, 'activity', 2000)
  const history = [...(existing?.history ?? []), ...(activity ? [{ at: new Date().toISOString(), text: activity }] : [])].slice(-100)
  const customer: OperationsCustomer = { trialIds: [...new Set(trialIds)], contractStatus: contractStatus as OperationsCustomer['contractStatus'], history, id: id ?? randomBytes(12).toString('hex'), name: field(merged, 'name', 100, true), hotelName: field(merged, 'hotelName'), email: field(merged, 'email'), note: field(merged, 'note', 2000), agencyId, createdAt: existing?.createdAt ?? new Date().toISOString() }
  if (actor.role === 'PLATFORM_ADMIN' && input.agencyId !== undefined) await kv.hset('operations:customer-owners', customer.id, agencyId ?? '')
  await kv.hset(CUSTOMERS, customer.id, JSON.stringify(customer))
  return customer
}
