// デモのトライアルのパスワード再発行（運営用 URL の運営だけ）

import { type NextRequest } from "next/server"

import { handle, ok } from "@/lib/demo-trials/server/http"
import { resetTrialPassword } from "@/lib/demo-trials/server/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, { admin: true }, async (kv) => {
    const { id } = await context.params
    return ok(await resetTrialPassword(kv, id))
  })
}
