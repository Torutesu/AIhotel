// 運営のログイン（運営用 URL だけ）。まだ登録が無ければ、このパスワードを運営のパスワードとして登録する

import { NextResponse, type NextRequest } from "next/server"

import { DemoTrialError } from "@/lib/demo-trials/core"
import {
  ADMIN_COOKIE, clearSessionCookie, clientIp, handle, isAdminConsole, ok, readJson, setSessionCookie,
} from "@/lib/demo-trials/server/http"
import { agencyLogin, platformIdentity } from "@/lib/demo-trials/server/operations"
import { ADMIN_SESSION_SECONDS, adminLogin } from "@/lib/demo-trials/server/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return handle(request, {}, async (kv) => {
    if (!isAdminConsole()) throw new DemoTrialError(403, "この URL では運営としてログインできません")
    const { email, password } = await readJson(request)
    // 運営 ID はサーバー専用の環境変数で管理する。公開コードには含めない。
    const adminEmail = process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase()
    if (!adminEmail) throw new DemoTrialError(503, "運営ログインが設定されていません")
    if (typeof email !== "string" || email.length > 200 || typeof password !== "string" || password.length === 0 || password.length > 200) {
      throw new DemoTrialError(400, "メールアドレスとパスワードを入力してください")
    }
    const loginEmail = email.trim().toLowerCase()
    const result = loginEmail === adminEmail
      ? { cookie: await adminLogin(kv, password, clientIp(request)), identity: platformIdentity() }
      : await agencyLogin(kv, loginEmail, password, clientIp(request))
    const cookie = result.cookie
    const response = ok({ loggedIn: true, identity: result.identity })
    setSessionCookie(response, request, ADMIN_COOKIE, cookie, ADMIN_SESSION_SECONDS)
    return response
  })
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, data: null })
  clearSessionCookie(response, ADMIN_COOKIE)
  return response
}

/** Restore from the signed cookie, never from browser role flags. */
export async function GET(request: NextRequest) {
  return handle(request, { admin: true }, async (_kv, identity) => ok(identity))
}
