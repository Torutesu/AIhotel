// デモモード（バックエンド未接続）で運営の管理画面を試すための、ブラウザ内だけのデータ。
//
// テナント管理・トライアル管理・IP 制限の操作をタブ内（sessionStorage）で再現する。
// サーバーには何も保存しないので、タブを閉じると元に戻る。発行したトライアルの ID はこのタブのデモでだけログインできる。
// デモの共有保存（demo-shared.ts）が設定されていれば、トライアルはそちらを使う（demoTrials）。

import type {
  CreateTrialRequest,
  IpAllowEntry,
  IpRestrictionSettings,
  TenantSummary,
  TrialCredentials,
  TrialSummary,
  UpdateTrialRequest,
} from "@shared/types"
import {
  DemoTrialError, applyTrialUpdate, assertCanLogin, newTrialRecord, randomHex, randomPassword, sortTrials, summarize,
  type DemoTrialRecord,
} from "@/lib/demo-trials/core"
import { ApiClientError, MOCK_TENANT_ID } from "./client"
import { demoShared, demoSharedStatus } from "./demo-shared"

const STORAGE_KEY = "demo-admin-state"
/** デモでの「あなたの今のアクセス元」（文書用の IP アドレス） */
export const DEMO_CURRENT_IP = "203.0.113.10"

interface DemoAdminState {
  tenants: TenantSummary[]
  /** secret はパスワードそのもの（タブの中だけのデモのため） */
  trials: DemoTrialRecord[]
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

/** デモの規則のエラーを画面の API エラーに直す */
function asApiError<T>(run: () => T): T {
  try {
    return run()
  } catch (err) {
    if (err instanceof DemoTrialError) throw new ApiClientError(err.status, err.message)
    throw err
  }
}

function findTrial(state: DemoAdminState, id: string): DemoTrialRecord {
  const trial = state.trials.find((t) => t.id === id)
  if (!trial) throw new ApiClientError(404, "トライアルが見つかりません")
  return trial
}

function replaceTrial(state: DemoAdminState, record: DemoTrialRecord) {
  state.trials = state.trials.map((t) => (t.id === record.id ? record : t))
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
    return sortTrials(load().trials.map((t) => summarize(t, now)))
  },

  createTrial(input: CreateTrialRequest): TrialCredentials {
    const state = load()
    const password = randomPassword()
    const record = asApiError(() => newTrialRecord(input, state.trials, password))
    state.trials.push(record)
    save(state)
    return { trial: summarize(record), password }
  },

  updateTrial(id: string, input: UpdateTrialRequest): TrialSummary {
    const state = load()
    const record = asApiError(() => applyTrialUpdate(findTrial(state, id), input))
    replaceTrial(state, record)
    save(state)
    return summarize(record)
  },

  resetTrialPassword(id: string): TrialCredentials {
    const state = load()
    const password = randomPassword()
    const record = { ...findTrial(state, id), secret: password }
    replaceTrial(state, record)
    save(state)
    return { trial: summarize(record), password }
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
    const loginEmail = email.trim().toLowerCase()
    const trial = state.trials.find((t) => t.loginEmail === loginEmail && t.secret === password)
    if (!trial) return null
    asApiError(() => assertCanLogin(trial))
    replaceTrial(state, { ...trial, lastLoginAt: new Date().toISOString() })
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

/**
 * デモのトライアル管理。共有保存が設定されていればそちら（どの端末・URL でも同じ一覧）、
 * 無ければこのタブの中だけで再現する
 */
export const demoTrials = {
  async trials(): Promise<TrialSummary[]> {
    return (await demoSharedStatus()).shared ? demoShared.trials() : demoAdmin.trials()
  },
  async createTrial(input: CreateTrialRequest): Promise<TrialCredentials> {
    return (await demoSharedStatus()).shared ? demoShared.createTrial(input) : demoAdmin.createTrial(input)
  },
  async updateTrial(id: string, input: UpdateTrialRequest): Promise<TrialSummary> {
    return (await demoSharedStatus()).shared ? demoShared.updateTrial(id, input) : demoAdmin.updateTrial(id, input)
  },
  async resetTrialPassword(id: string): Promise<TrialCredentials> {
    return (await demoSharedStatus()).shared ? demoShared.resetTrialPassword(id) : demoAdmin.resetTrialPassword(id)
  },
  async deleteTrial(id: string): Promise<void> {
    return (await demoSharedStatus()).shared ? demoShared.deleteTrial(id) : demoAdmin.deleteTrial(id)
  },
}
