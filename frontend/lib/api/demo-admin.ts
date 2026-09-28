// デモモード（バックエンド未接続）で運営の管理画面を試すための、ブラウザ内だけのデータ。
//
// テナント管理・トライアル管理・IP 制限の操作をタブ内（sessionStorage）で再現する。
// サーバーには何も保存しないので、タブを閉じると元に戻る。発行したトライアルの ID はこのタブのデモでだけログインできる。

import type {
  CreateTrialRequest,
  IpAllowEntry,
  IpRestrictionSettings,
  TenantSummary,
  TrialCredentials,
  TrialSummary,
  UpdateTrialRequest,
} from "@shared/types"
import { ApiClientError, MOCK_TENANT_ID } from "./client"

const STORAGE_KEY = "demo-admin-state"
const DAY_MS = 86_400_000
/** デモでの「あなたの今のアクセス元」（文書用の IP アドレス） */
export const DEMO_CURRENT_IP = "203.0.113.10"

interface DemoTrial extends TrialSummary {
  password: string
  isActive: boolean
}

interface DemoAdminState {
  tenants: TenantSummary[]
  trials: DemoTrial[]
  ip: { enabled: boolean; entries: IpAllowEntry[] }
}

function initialState(): DemoAdminState {
  const now = new Date().toISOString()
  return {
    tenants: [
      {
        id: MOCK_TENANT_ID,
        name: "デモテナント",
        code: "demo-tenant",
        isActive: true,
        ipRestrictionEnabled: false,
        createdAt: now,
        updatedAt: now,
        hotelCount: 1,
        userCount: 3,
      },
    ],
    trials: [],
    ip: { enabled: false, entries: [] },
  }
}

function load(): DemoAdminState {
  if (typeof window === "undefined") return initialState()
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DemoAdminState) : initialState()
  } catch {
    return initialState()
  }
}

function save(state: DemoAdminState) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 保存できなくても画面の操作は続けられる
  }
}

function randomHex(length: number): string {
  let out = ""
  while (out.length < length) out += Math.floor(Math.random() * 16).toString(16)
  return out
}

function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
  let out = "Aa2"
  while (out.length < 12) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** 保存しているトライアルに、今の時刻から状態・残り日数を付け直す */
function summarize(trial: DemoTrial, now = Date.now()): TrialSummary {
  const expiresAt = new Date(trial.expiresAt).getTime()
  const expired = expiresAt <= now
  const { password: _password, isActive, ...rest } = trial
  return {
    ...rest,
    status: !isActive ? "SUSPENDED" : expired ? "EXPIRED" : "ACTIVE",
    daysLeft: expired ? 0 : Math.ceil((expiresAt - now) / DAY_MS),
    purgeAt: expired ? new Date(expiresAt + 30 * DAY_MS).toISOString() : null,
  }
}

function findTrial(state: DemoAdminState, id: string): DemoTrial {
  const trial = state.trials.find((t) => t.id === id)
  if (!trial) throw new ApiClientError(404, "トライアルが見つかりません")
  return trial
}

export const demoAdmin = {
  tenants(): TenantSummary[] {
    return load().tenants
  },

  createTenant(input: { name: string; code: string }): TenantSummary {
    const state = load()
    if (state.tenants.some((t) => t.code === input.code)) {
      throw new ApiClientError(409, `コード「${input.code}」のテナントは既に登録されています`)
    }
    const now = new Date().toISOString()
    const tenant: TenantSummary = {
      id: `demo-${randomHex(8)}`,
      name: input.name,
      code: input.code,
      isActive: true,
      ipRestrictionEnabled: false,
      createdAt: now,
      updatedAt: now,
      hotelCount: 0,
      userCount: 0,
    }
    state.tenants.push(tenant)
    save(state)
    return tenant
  },

  updateTenant(id: string, input: { name?: string; isActive?: boolean }): TenantSummary {
    const state = load()
    const tenant = state.tenants.find((t) => t.id === id)
    if (!tenant) throw new ApiClientError(404, "テナントが見つかりません")
    Object.assign(tenant, input, { updatedAt: new Date().toISOString() })
    save(state)
    return tenant
  },

  disableTenantIpRestriction(id: string): void {
    const state = load()
    const tenant = state.tenants.find((t) => t.id === id)
    if (!tenant) throw new ApiClientError(404, "テナントが見つかりません")
    tenant.ipRestrictionEnabled = false
    if (id === MOCK_TENANT_ID) state.ip.enabled = false
    save(state)
  },

  trials(): TrialSummary[] {
    const now = Date.now()
    return load()
      .trials.map((t) => summarize(t, now))
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
  },

  createTrial(input: CreateTrialRequest): TrialCredentials {
    const state = load()
    const suffix = randomHex(8)
    const loginEmail = input.loginEmail ?? `trial-${suffix}@trial.example.com`
    if (state.trials.some((t) => t.loginEmail === loginEmail)) {
      throw new ApiClientError(409, "このログイン ID は既に使われています")
    }
    const now = Date.now()
    const trial: DemoTrial = {
      id: `demo-trial-${suffix}`,
      name: input.name,
      kind: input.kind,
      note: input.note ?? null,
      status: "ACTIVE",
      expiresAt: new Date(now + (input.days ?? 30) * DAY_MS).toISOString(),
      daysLeft: input.days ?? 30,
      purgeAt: null,
      loginEmail,
      lastLoginAt: null,
      createdAt: new Date(now).toISOString(),
      password: randomPassword(),
      isActive: true,
    }
    state.trials.push(trial)
    save(state)
    return { trial: summarize(trial, now), password: trial.password }
  },

  updateTrial(id: string, input: UpdateTrialRequest): TrialSummary {
    const state = load()
    const trial = findTrial(state, id)
    const now = Date.now()
    if (input.extendDays !== undefined) {
      const base = Math.max(now, new Date(trial.expiresAt).getTime())
      const next = base + input.extendDays * DAY_MS
      if (next - now > 90 * DAY_MS) throw new ApiClientError(400, "期限は今日から90日以内にしてください")
      trial.expiresAt = new Date(next).toISOString()
    }
    if (input.name !== undefined) trial.name = input.name
    if (input.note !== undefined) trial.note = input.note
    if (input.isActive !== undefined) trial.isActive = input.isActive
    save(state)
    return summarize(trial, now)
  },

  resetTrialPassword(id: string): TrialCredentials {
    const state = load()
    const trial = findTrial(state, id)
    trial.password = randomPassword()
    save(state)
    return { trial: summarize(trial), password: trial.password }
  },

  deleteTrial(id: string): void {
    const state = load()
    findTrial(state, id)
    state.trials = state.trials.filter((t) => t.id !== id)
    save(state)
  },

  /**
   * デモで発行したトライアルの ID・パスワードでのログイン。一致しなければ null。
   * 期限切れ・停止中は本番と同じ理由で断る
   */
  trialLogin(email: string, password: string): { name: string; expiresAt: string } | null {
    const state = load()
    const trial = state.trials.find((t) => t.loginEmail === email && t.password === password)
    if (!trial) return null
    if (!trial.isActive) throw new ApiClientError(401, "メールアドレスまたはパスワードが正しくありません")
    if (new Date(trial.expiresAt).getTime() <= Date.now()) {
      throw new ApiClientError(401, "トライアル期間が終了しました。延長をご希望の場合は担当者にお問い合わせください")
    }
    trial.lastLoginAt = new Date().toISOString()
    save(state)
    return { name: trial.name, expiresAt: trial.expiresAt }
  },

  ipRestriction(): IpRestrictionSettings {
    const { ip } = load()
    return { ...ip, currentIp: DEMO_CURRENT_IP }
  },

  updateIpRestriction(input: { enabled: boolean; entries: IpAllowEntry[] }): IpRestrictionSettings {
    if (input.enabled && input.entries.length === 0) {
      throw new ApiClientError(400, "IP 制限を有効にするには、許可するアドレスを1件以上登録してください")
    }
    // デモでは完全一致だけで締め出し防止を再現する（範囲の照合はバックエンドが行う）
    if (input.enabled && !input.entries.some((e) => e.cidr.split("/")[0] === DEMO_CURRENT_IP)) {
      throw new ApiClientError(
        400,
        `今のアクセス元（${DEMO_CURRENT_IP}）が許可リストに入っていません。このまま保存すると、あなた自身がログインできなくなります`,
      )
    }
    const state = load()
    state.ip = { enabled: input.enabled, entries: input.entries }
    const tenant = state.tenants.find((t) => t.id === MOCK_TENANT_ID)
    if (tenant) tenant.ipRestrictionEnabled = input.enabled
    save(state)
    return { ...state.ip, currentIp: DEMO_CURRENT_IP }
  },
}
