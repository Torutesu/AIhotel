// デモのトライアルの共有保存（app/api/demo/）を呼ぶ。デモモードでだけ使う。
//
// 共有保存（Upstash Redis）が設定されていれば、運営用 URL で発行したトライアルの ID が
// 配布用 URL や他の人の端末でも使える。未設定ならブラウザ内の保存（demo-admin.ts）に戻る。

import type { CreateTrialRequest, TrialCredentials, TrialSummary, UpdateTrialRequest } from "@shared/types"
import { ApiClientError } from "./client"

export interface DemoSharedStatus {
  shared: boolean
  adminConsole: boolean
  adminConfigured: boolean
}

type Envelope<T> = { success: true; data: T } | { success: false; error: string }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init.headers },
    })
  } catch {
    throw new ApiClientError(0, "サーバーに接続できません。通信環境を確認してもう一度お試しください")
  }
  const body = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!res.ok || !body || !body.success) {
    throw new ApiClientError(res.status, body && !body.success ? body.error : "処理に失敗しました")
  }
  return body.data
}

let statusPromise: Promise<DemoSharedStatus> | null = null

/** 共有保存が使えるか（1回だけ問い合わせる。失敗したらブラウザ内の保存を使う） */
export function demoSharedStatus(): Promise<DemoSharedStatus> {
  statusPromise ??= call<DemoSharedStatus>("/api/demo/status").catch(() => {
    statusPromise = null
    return { shared: false, adminConsole: false, adminConfigured: false }
  })
  return statusPromise
}

/** テスト用 */
export function resetDemoSharedStatus() {
  statusPromise = null
}

export const demoShared = {
  adminLogin(password: string): Promise<{ loggedIn: true }> {
    return call("/api/demo/admin/session", { method: "POST", body: JSON.stringify({ password }) })
  },
  async adminLogout(): Promise<void> {
    await call("/api/demo/admin/session", { method: "DELETE" }).catch(() => undefined)
  },
  trials(): Promise<TrialSummary[]> {
    return call("/api/demo/trials")
  },
  createTrial(input: CreateTrialRequest): Promise<TrialCredentials> {
    return call("/api/demo/trials", { method: "POST", body: JSON.stringify(input) })
  },
  updateTrial(id: string, input: UpdateTrialRequest): Promise<TrialSummary> {
    return call(`/api/demo/trials/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) })
  },
  resetTrialPassword(id: string): Promise<TrialCredentials> {
    return call(`/api/demo/trials/${encodeURIComponent(id)}/reset-password`, { method: "POST" })
  },
  async deleteTrial(id: string): Promise<void> {
    await call(`/api/demo/trials/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
  /** 該当するトライアルが無ければ null */
  trialLogin(email: string, password: string): Promise<{ name: string; expiresAt: string } | null> {
    return call("/api/demo/trial-session", { method: "POST", body: JSON.stringify({ email, password }) })
  },
  trialSession(): Promise<{ active: true; name: string; expiresAt: string } | { active: false; message: string }> {
    return call("/api/demo/trial-session")
  },
  async trialLogout(): Promise<void> {
    await call("/api/demo/trial-session", { method: "DELETE" }).catch(() => undefined)
  },
}
