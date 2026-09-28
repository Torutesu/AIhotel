// デモのトライアルの更新（名前・メモ・停止／再開・延長）と削除（運営用 URL の運営だけ）

import { type NextRequest } from "next/server"

import type { UpdateTrialRequest } from "@shared/types"
import { handle, ok, readJson } from "@/lib/demo-trials/server/http"
import { deleteTrial, trialLoginInfo, updateTrial } from "@/lib/demo-trials/server/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: Context) {
  return handle(request, { admin: true }, async (kv) => {
    const { id } = await context.params
    return ok(await trialLoginInfo(kv, id))
  })
}

export async function PUT(request: NextRequest, context: Context) {
  return handle(request, { admin: true }, async (kv) => {
    const { id } = await context.params
    const body = await readJson(request)
    const input: UpdateTrialRequest = {}
    if (typeof body.name === "string") input.name = body.name
    if (typeof body.note === "string" || body.note === null) input.note = body.note as string | null
    if (typeof body.isActive === "boolean") input.isActive = body.isActive
    if (typeof body.extendDays === "number") input.extendDays = body.extendDays
    return ok(await updateTrial(kv, id, input))
  })
}

export async function DELETE(request: NextRequest, context: Context) {
  return handle(request, { admin: true }, async (kv) => {
    const { id } = await context.params
    await deleteTrial(kv, id)
    return ok(null)
  })
}
