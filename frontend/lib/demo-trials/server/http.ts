// app/api/demo/ のルートの共通処理（サーバー専用）。
//
// - デモモード（NEXT_PUBLIC_DEMO_MODE=true）のビルドでだけ動く。本番ビルドではすべて 404
// - 共有保存（Upstash）が未設定なら 503。画面は GET /api/demo/status を見てブラウザ内の保存に切り替える
// - 運営の操作は運営用 URL（NEXT_PUBLIC_DEMO_ADMIN_CONSOLE=true）で、運営の Cookie があるときだけ
// - レスポンスはバックエンドと同じ { success, data } / { success: false, error } の形

import { NextResponse, type NextRequest } from "next/server"

import { clientIpOptionsFromEnv, resolveClientIp } from "@/lib/client-ip"
import { DemoTrialError } from "../core"
import { kvConfigFromEnv, upstashKv, type DemoKv } from "./kv"
import { verifyAdminSession } from "./service"

export const ADMIN_COOKIE = "demo_admin"
export const TRIAL_COOKIE = "demo_trial"
const COOKIE_PATH = "/api/demo"

export function isDemoBuild(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true"
}

export function isAdminConsole(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_ADMIN_CONSOLE === "true"
}

export function sharedKv(): DemoKv | null {
  const config = kvConfigFromEnv(process.env)
  return config ? upstashKv(config) : null
}

export function clientIp(request: NextRequest): string | null {
  return resolveClientIp(request.headers.get("x-forwarded-for"), clientIpOptionsFromEnv(process.env))
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status })
}

function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

export function setSessionCookie(response: NextResponse, request: NextRequest, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge,
  })
}

export function clearSessionCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", { httpOnly: true, sameSite: "strict", path: COOKIE_PATH, maxAge: 0 })
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoTrialError(400, "入力が正しくありません")
  return body as Record<string, unknown>
}

interface HandlerOptions {
  /** 運営の操作（運営用 URL ＋ 運営の Cookie が必要） */
  admin?: boolean
}

/** デモのルートを包む。無効なビルド・未設定・権限なし・想定内のエラーをここで応答にする */
export async function handle(
  request: NextRequest,
  options: HandlerOptions,
  run: (kv: DemoKv) => Promise<NextResponse>,
): Promise<NextResponse> {
  if (!isDemoBuild()) return fail(404, "見つかりません")
  const kv = sharedKv()
  if (!kv) return fail(503, "デモの共有保存が設定されていません")
  try {
    if (options.admin) {
      if (!isAdminConsole()) return fail(403, "この URL では運営の操作はできません")
      if (!(await verifyAdminSession(kv, request.cookies.get(ADMIN_COOKIE)?.value))) {
        return fail(401, "運営としてログインし直してください")
      }
    }
    return await run(kv)
  } catch (err) {
    if (err instanceof DemoTrialError) return fail(err.status, err.message)
    console.error("[demo-trials]", err instanceof Error ? err.message : "unknown error")
    return fail(500, "処理に失敗しました。時間をおいてもう一度お試しください")
  }
}
