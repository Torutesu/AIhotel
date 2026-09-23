// リクエストごとに CSP の nonce を作る（#85）。
// Next.js はリクエストヘッダの Content-Security-Policy から nonce を読み取り、
// 自分が出力するインラインスクリプトに付ける。app/layout.tsx は x-nonce を読んで
// next-themes のインラインスクリプトにも同じ nonce を渡す。

import { NextResponse, type NextRequest } from "next/server"

import { buildContentSecurityPolicy } from "@/lib/security-headers"

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const csp = buildContentSecurityPolicy(nonce, { isDev: process.env.NODE_ENV === "development" })

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", csp)
  return response
}

export const config = {
  matcher: [
    {
      // API 中継（JSON / バイナリ）と静的ファイルには CSP を付けない
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
