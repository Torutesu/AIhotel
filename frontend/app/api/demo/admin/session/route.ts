// 運営のログイン（運営用 URL だけ）。まだ登録が無ければ、このパスワードを運営のパスワードとして登録する

import { NextResponse, type NextRequest } from "next/server"

import { DemoTrialError } from "@/lib/demo-trials/core"
import {
  ADMIN_COOKIE, clearSessionCookie, clientIp, handle, isAdminConsole, ok, readJson, setSessionCookie,
} from "@/lib/demo-trials/server/http"
import { ADMIN_SESSION_SECONDS, adminLogin } from "@/lib/demo-trials/server/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return handle(request, {}, async (kv) => {
    if (!isAdminConsole()) throw new DemoTrialError(403, "この URL では運営としてログインできません")
    const { password } = await readJson(request)
    if (typeof password !== "string" || password.length === 0 || password.length > 200) {
      throw new DemoTrialError(400, "パスワードを入力してください")
    }
    const cookie = await adminLogin(kv, password, clientIp(request))
    const response = ok({ loggedIn: true })
    setSessionCookie(response, request, ADMIN_COOKIE, cookie, ADMIN_SESSION_SECONDS)
    return response
  })
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, data: null })
  clearSessionCookie(response, ADMIN_COOKIE)
  return response
}
