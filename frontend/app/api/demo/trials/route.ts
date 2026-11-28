// デモのトライアルの一覧・発行（運営用 URL の運営だけ）

import { type NextRequest } from "next/server"

import type { CreateTrialRequest } from "@shared/types"
import { handle, ok, readJson } from "@/lib/demo-trials/server/http"
import { validateAgency } from "@/lib/demo-trials/server/operations"
import { createTrial, listTrials } from "@/lib/demo-trials/server/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  return handle(request, { admin: true }, async (kv, actor) => ok(await listTrials(kv, Date.now(), actor)))
}

export async function POST(request: NextRequest) {
  return handle(request, { admin: true }, async (kv, actor) => {
    const body = await readJson(request)
    const input: CreateTrialRequest = {
      name: typeof body.name === "string" ? body.name : "",
      kind: body.kind as CreateTrialRequest["kind"],
      days: typeof body.days === "number" ? body.days : undefined,
      note: typeof body.note === "string" ? body.note : null,
      loginEmail: typeof body.loginEmail === "string" ? body.loginEmail : undefined,
    }
    return ok(await createTrial(kv, input, Date.now(), actor, actor.role === "PLATFORM_ADMIN" ? await validateAgency(kv, body.agencyId) : actor.id), 201)
  })
}
