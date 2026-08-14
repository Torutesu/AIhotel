import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // デモモードの既定値。バックエンド未接続時のみダミーデータへフォールバックし、
    // その場合は画面上部にデモ表示バナーを出す（サイレントフォールバックはしない）。
    // バックエンドを接続したら Vercel の環境変数に NEXT_PUBLIC_DEMO_MODE=false を設定して無効化する。
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE ?? 'true',
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
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
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
