import { defineConfig } from 'vitest/config'

// backend/src/lib/auth.ts はモジュール読み込み時に process.env.JWT_SECRET
// (32文字以上) を要求して throw するため、テストプロセス自体の環境変数に
// テスト用の値を設定しておく必要がある（DBは不要なユニットテストのみ実行）。
export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-jwt-secret-please-ignore-0123456789abcdef',
      JWT_EXPIRES_IN: '24h',
      JWT_REFRESH_EXPIRES_IN: '7d',
      NODE_ENV: 'test',
    },
    include: ['src/**/*.test.ts'],
  },
})
