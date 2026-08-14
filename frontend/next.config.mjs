import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // デモモードは lib/api.ts 側で「"false" のときだけ無効」と判定する。
    // 未設定時に process.env.NEXT_PUBLIC_DEMO_MODE が undefined へインライン化されても
    // 有効側に倒れるため、ここでは値をそのまま渡すだけにしている。
    // バックエンドを接続したら、ホスティング側の環境変数に NEXT_PUBLIC_DEMO_MODE=false を設定して無効化する。
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE ?? '',
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
