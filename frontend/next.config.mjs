import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// CSP 以外のセキュリティヘッダ（#85）。CSP はリクエストごとの nonce が要るため
// middleware.ts（lib/security-headers.ts）で付ける。
// Strict-Transport-Security は HTTPS で配信したときだけブラウザが解釈する
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // X-Powered-By: Next.js を出さない（#85）
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
  env: {
    // デモモードは opt-in。lib/api.ts 側で「"true" のときだけ有効」と判定する。
    // 未設定時は '' がインライン化されて無効になり、デモ分岐はツリーシェイクで成果物から消える
    // （scripts/verify-demo-mode.mjs --expect-disabled で検証できる）。
    // クライアントへのUI確認・デモ用ビルドでのみ NEXT_PUBLIC_DEMO_MODE=true を設定する。
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE ?? '',
  },
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    // コンパイルタイムアウトを延長
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 600,
      poll: 1000,
    }
    // Path aliases for shared types
    config.resolve.alias = {
      ...config.resolve.alias,
      '@shared': path.resolve(__dirname, '../shared'),
    }
    return config
  },
  // 開発サーバーのタイムアウト設定
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
  // /api/* の中継は app/api/[...path]/route.ts のルートハンドラで行う。
  // rewrites() の destination は `next build` 時に routes-manifest.json へ焼き込まれ、
  // 実行時の BACKEND_URL では差し替えられないため、ここでは定義しない（F-10）。
}

export default nextConfig
