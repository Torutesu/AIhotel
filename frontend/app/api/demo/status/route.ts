// デモの共有保存が使えるか（画面はこれを見て、共有保存かブラウザ内の保存かを決める）

import { type NextRequest } from "next/server"

import { handle, isAdminConsole, isDemoBuild, ok, sharedKv } from "@/lib/demo-trials/server/http"
import { adminConfigured } from "@/lib/demo-trials/server/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  if (isDemoBuild() && !sharedKv()) return ok({ shared: false, adminConsole: isAdminConsole(), adminConfigured: false })
  return handle(request, {}, async (kv) =>
    ok({ shared: true, adminConsole: isAdminConsole(), adminConfigured: await adminConfigured(kv) }),
  )
}
