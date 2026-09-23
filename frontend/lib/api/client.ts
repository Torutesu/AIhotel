"use client"

// API クライアントの土台（#91 で lib/api.ts から分割）
// same-origin の /api/* を呼ぶ共通リクエスト、トークンの保存、トークン更新（single-flight）、
// デモモード（バックエンド未接続時のサンプル表示）の切替を扱う。
// /api/* は app/api/[...path]/route.ts がサーバー専用の BACKEND_URL へ中継する（F-10）。

import type {
  ApiResponse,
  User,
  UserRole,
  HotelDto as Hotel,
} from "@shared/types"
import {
  LoginResult,
} from "./types"

export const ACCESS_TOKEN_KEY = "hrms.accessToken"
export const REFRESH_TOKEN_KEY = "hrms.refreshToken"
export const MOCK_USER_KEY = "hrms.mockUser"

/** 常に same-origin。rewrite（next.config.mjs）が /api/* をバックエンドへ中継する。 */
export const BASE_URL = ""

export class ApiClientError extends Error {
  status: number
  /** バックエンド自体に到達できなかった（接続失敗/非JSON応答）場合のみ true。開発用モックログインの発火条件に使う。 */
  isBackendUnreachable: boolean
  /** 項目ごとのエラー（バリデーションエラー時の `errors`）。取り込みの行番号表示などに使う（#82） */
  fieldErrors: Array<{ field: string; message: string }>
  constructor(
    status: number,
    message: string,
    isBackendUnreachable = false,
    fieldErrors: Array<{ field: string; message: string }> = [],
  ) {
    super(message)
    this.status = status
    this.isBackendUnreachable = isBackendUnreachable
    this.fieldErrors = fieldErrors
  }
}

// ---- Token storage ----

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function storeTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(MOCK_USER_KEY)
}

// ---- デモモード（バックエンド未接続時のダミーデータ表示） ----
// ビルド時に NEXT_PUBLIC_DEMO_MODE=true が明示された場合のみ有効（opt-in。既定は無効）。
// 有効時もバックエンドが応答する限り常に実APIを使用し、接続できない場合に限りダミーデータへ
// フォールバックする。フォールバックが起きた場合は画面上部にデモ表示バナーを出すため、
// 「モックへのサイレントフォールバック禁止」の規約には抵触しない。
// 本番ビルドではこの変数を設定しないこと（デモ分岐はツリーシェイクで成果物から消える）。

export const MOCK_PASSWORD = "Admin1234"
export const MOCK_HOTEL_ID = "demo-hotel-001"
export const MOCK_TENANT_ID = "mock-tenant"

export const MOCK_ACCOUNTS: Record<string, { name: string; role: UserRole }> = {
  "admin@demo-hotel.example.com": { name: "管理者", role: "ADMIN" },
  "manager@demo-hotel.example.com": { name: "レベニューマネージャー", role: "MANAGER" },
  "operator@demo-hotel.example.com": { name: "フロント担当", role: "OPERATOR" },
}

export const MOCK_HOTEL: Hotel = {
  id: MOCK_HOTEL_ID,
  tenantId: MOCK_TENANT_ID,
  name: "デモホテル東京",
  address: "東京都千代田区丸の内1-1-1",
  phone: "03-1234-5678",
  email: "info@demo-hotel.example.com",
  totalRooms: 200,
  weekendDays: [5, 6],
  hotelType: "FULL_SERVICE",
  prefectureCode: "13",
  municipalityCode: "131016",
  marketArea: "丸の内",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/**
 * デモモードが有効か（ビルド時に NEXT_PUBLIC_DEMO_MODE=true が明示されたときのみ true）。
 * 未設定・値の誤り（例: "ture"）は無効側に倒す（opt-in）。本番ビルドで誤ってデモ認証情報や
 * ダミーデータが表示されないようにするため、「既定で無効・明示的に有効化」の向きにしている。
 * なおフォールバックの発動条件はバックエンドに到達できない場合のみで、
 * 実APIが応答する限り常に実データを優先する。
 */
export function isDemoModeEnabled(): boolean {
  // 注意: 他モジュールからこの関数を呼ぶ分岐はミニファイアで畳み込まれず、無効ビルドでも
  // 分岐内のコードが成果物に残る（実行はされない）。成果物から確実に除去したい JSX 等では
  // `process.env.NEXT_PUBLIC_DEMO_MODE === "true"` をそのモジュール内で直接評価すること
  // （login-form.tsx 参照。verify-demo-mode.mjs で検証している）。
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true"
}

// ---- デモデータ表示状態（バナー通知用） ----
// フォールバックが1回でも発生したら true になり、画面上部にデモ表示バナーを出す。
export let demoDataInUse = false

export function isDemoDataInUse(): boolean {
  return demoDataInUse
}

/** デモデータ利用開始を購読する（バナー表示用） */
export function subscribeDemoData(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener("demoDataInUse", listener)
  return () => window.removeEventListener("demoDataInUse", listener)
}

export function markDemoDataInUse() {
  if (demoDataInUse) return
  demoDataInUse = true
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("demoDataInUse"))
  }
}

export function storeMockUser(user: User) {
  localStorage.setItem(MOCK_USER_KEY, JSON.stringify(user))
}

export function getMockUser(): User | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(MOCK_USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function mockLogin(email: string, password: string): LoginResult {
  const account = MOCK_ACCOUNTS[email]
  if (!account || password !== MOCK_PASSWORD) {
    throw new ApiClientError(401, "メールアドレスまたはパスワードが正しくありません")
  }
  const now = new Date()
  const user: User = {
    id: `mock-${account.role.toLowerCase()}`,
    tenantId: MOCK_TENANT_ID,
    email,
    name: account.name,
    role: account.role,
    hotelId: MOCK_HOTEL_ID,
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }
  return {
    user,
    tokens: { accessToken: `mock.${user.id}`, refreshToken: `mock-refresh.${user.id}` },
  }
}

export async function withDemoFallback<T>(request: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await request()
  } catch (err) {
    if (isDemoModeEnabled() && err instanceof ApiClientError && err.isBackendUnreachable) {
      markDemoDataInUse()
      return fallback()
    }
    throw err
  }
}

// ---- Core request ----

export async function rawRequest<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<T> {
  const token = getAccessToken()
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    })
  } catch {
    throw new ApiClientError(0, "バックエンドに接続できません", true)
  }

  // ログイン自体の 401（認証情報の誤り）はリフレッシュ対象外
  if (res.status === 401 && retryOn401 && !path.startsWith("/api/v1/auth/login")) {
    // 並列に 401 を受けても tryRefresh() は single-flight なので実際の更新は 1 回だけ
    const refreshed = await tryRefresh()
    if (refreshed) {
      return rawRequest<T>(path, options, false)
    }
  }

  let body: ApiResponse<T>
  try {
    body = await res.json()
  } catch {
    throw new ApiClientError(res.status, `サーバーエラー (${res.status})`, true)
  }

  if (!res.ok || !body.success) {
    throw new ApiClientError(
      res.status,
      body.error || `リクエストに失敗しました (${res.status})`,
      false,
      body.errors ?? [],
    )
  }

  return body.data as T
}

/** ダウンロード用のバイナリレスポンス */
export interface BinaryDownload {
  blob: Blob
  /** Content-Disposition から取り出したファイル名（取れなければ null） */
  filename: string | null
}

/**
 * バイナリ（PDF/Excel）を取得する。レポート出力のように成功時のエンベロープを持たない
 * エンドポイント専用。失敗時はJSONのエラーエンベロープが返るため、そちらを読んで例外にする。
 */
export async function rawBinaryRequest(path: string, retryOn401 = true): Promise<BinaryDownload> {
  const token = getAccessToken()
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    })
  } catch {
    throw new ApiClientError(0, "バックエンドに接続できません", true)
  }

  if (res.status === 401 && retryOn401) {
    const refreshed = await tryRefresh()
    if (refreshed) return rawBinaryRequest(path, false)
  }

  if (!res.ok) {
    let message = `リクエストに失敗しました (${res.status})`
    try {
      const body = (await res.json()) as ApiResponse<unknown>
      if (body?.error) message = body.error
    } catch {
      // JSONでない場合は既定のメッセージを使う
    }
    throw new ApiClientError(res.status, message)
  }

  return {
    blob: await res.blob(),
    filename: parseContentDispositionFilename(res.headers.get("Content-Disposition")),
  }
}

export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      // デコードできなければ素の filename にフォールバックする
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : null
}

/**
 * 認証が完全に失効したことをアプリ全体に通知する（F-2）。
 * AuthProvider がこのイベントを購読してユーザーを破棄し、ログイン画面に戻す。
 */
export const AUTH_EXPIRED_EVENT = "auth:expired"

export function notifyAuthExpired() {
  clearTokens()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
}

/**
 * 実行中のリフレッシュ処理（single-flight 用）。
 * 並列リクエストが同時に 401 を受けても、リフレッシュは 1 回だけ実行し全員でその結果を共有する。
 * 各々がリフレッシュを投げるとトークンローテーションで後続が無効トークンを掴み、
 * 結果として全員ログアウトになってしまうため（F-2）。
 */
export let refreshInFlight: Promise<boolean> | null = null

export async function performRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
    const body = await res.json()
    if (res.ok && body.success && body.data?.tokens) {
      storeTokens(body.data.tokens.accessToken, body.data.tokens.refreshToken)
      return true
    }
    // サーバーがリフレッシュを拒否した（期限切れ・失効済み）→ 認証終了
    notifyAuthExpired()
    return false
  } catch {
    // ネットワーク到達不可。トークンは失効していない可能性が高いので破棄しない。
    return false
  }
}

export async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    notifyAuthExpired()
    return false
  }
  if (!refreshInFlight) {
    refreshInFlight = performRefresh(refreshToken).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}
