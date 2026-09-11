import { defineConfig } from 'vitest/config'

// backend/src/lib/auth.ts はモジュール読み込み時に process.env.JWT_SECRET
// (32文字以上) を要求して throw するため、テストプロセス自体の環境変数に
// テスト用の値を設定しておく必要がある。
//
// DATABASE_URL はここでは設定しない。設定されていれば統合テスト（N-8）が
// 実DBに対して走り、未設定なら describe.skip でスキップされる。
export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-jwt-secret-please-ignore-0123456789abcdef',
      JWT_EXPIRES_IN: '24h',
      JWT_REFRESH_EXPIRES_IN: '7d',
      NODE_ENV: 'test',
      // 統合テストは意図的に 401/403/400 を起こすため、アプリのリクエストログが
      // 出力を埋め尽くす。テスト失敗の原因を読み取れるよう fatal だけに絞る
      LOG_LEVEL: 'fatal',
    },
    include: ['src/**/*.test.ts'],
  },
})
