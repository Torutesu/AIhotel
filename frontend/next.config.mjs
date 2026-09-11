import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  async rewrites() {
    // ブラウザは常に same-origin の /api/* を叩き（lib/api.ts）、ここでバックエンドへ中継する。
    // 中継先はサーバー専用の BACKEND_URL を優先する（ブラウザへ露出しない）。
    // NEXT_PUBLIC_BACKEND_URL は既存環境との後方互換のためのフォールバック（F-10）。
    const backendUrl =
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
