// トライアルの ID でのログイン（POST）と、ログイン中のトライアルがまだ使えるかの確認（GET）。
// 配布用 URL を含む、どのデモの URL でも使える

import { type NextRequest } from "next/server"

import { DemoTrialError } from "@/lib/demo-trials/core"
import { TRIAL_COOKIE, clearSessionCookie, clientIp, handle, ok, readJson, setSessionCookie } from "@/lib/demo-trials/server/http"
import { TRIAL_SESSION_SECONDS, trialLogin, trialSession } from "@/lib/demo-trials/server/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return handle(request, {}, async (kv) => {
    const { email, password } = await readJson(request)
    if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 200) {
      throw new DemoTrialError(400, "入力が正しくありません")
    }
    const result = await trialLogin(kv, email, password, clientIp(request))
    // 該当するトライアルが無いときは data: null（画面はデモの固定アカウントを試す）
    if (!result) return ok(null)
    const response = ok({ name: result.name, expiresAt: result.expiresAt })
    setSessionCookie(response, request, TRIAL_COOKIE, result.cookie, TRIAL_SESSION_SECONDS)
    return response
  })
}

export async function GET(request: NextRequest) {
  return handle(request, {}, async (kv) => {
    const session = await trialSession(kv, request.cookies.get(TRIAL_COOKIE)?.value)
    const response = ok(session)
    if (!session.active) clearSessionCookie(response, TRIAL_COOKIE)
    return response
  })
}

export async function DELETE() {
  const response = ok(null)
  clearSessionCookie(response, TRIAL_COOKIE)
  return response
}
