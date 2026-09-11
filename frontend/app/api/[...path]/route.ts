// バックエンドAPIへのリバースプロキシ（same-origin 中継）。
//
// ブラウザは常に same-origin の /api/* を叩く（frontend/lib/api.ts）。ここで
// サーバー側だけが知る BACKEND_URL へ中継するため、バックエンドのURLがブラウザに
// 露出せず、CORS 設定も不要になる。
//
// next.config.mjs の rewrites() ではなくルートハンドラを使う理由:
// rewrites の destination は `next build` 時に .next/routes-manifest.json へ
// 焼き込まれるため、実行時に環境変数を差し替えても反映されない。
// コンテナイメージを一度ビルドして環境ごとに BACKEND_URL を変える運用
// （docker/frontend.Dockerfile の想定）では、ここで毎リクエスト解決する必要がある。

import { type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function backendOrigin(): string {
  return (
    process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'
  ).replace(/\/$/, '')
}

// 中継してはいけないホップバイホップヘッダー。
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

function filterHeaders(source: Headers): Headers {
  const out = new Headers()
  source.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.append(key, value)
  })
  return out
}

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const target = `${backendOrigin()}/api/${path.join('/')}${request.nextUrl.search}`

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: filterHeaders(request.headers),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    })
  } catch {
    // バックエンドに到達できない場合も API 契約どおりの JSON を返す。
    // これによりクライアント側は「サーバーエラー(502)」ではなく通常のエラー表示ができる。
    return Response.json(
      { success: false, error: 'バックエンドに接続できません' },
      { status: 502 }
    )
  }

  // PDF / Excel などバイナリもそのまま返せるよう ArrayBuffer で受け渡す。
  const body = await upstream.arrayBuffer()
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: filterHeaders(upstream.headers),
  })
}

type Context = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path)
}
export async function POST(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path)
}
export async function PUT(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path)
}
export async function PATCH(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path)
}
export async function DELETE(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path)
}
export async function HEAD(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path)
}
export async function OPTIONS(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path)
}
