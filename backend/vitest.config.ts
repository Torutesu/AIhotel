import { defineConfig } from 'vitest/config'

// backend/src/lib/auth.ts はモジュール読み込み時に process.env.JWT_SECRET
// (32文字以上) を要求して throw するため、テストプロセス自体の環境変数に
// テスト用の値を設定しておく必要がある。
//
// DATABASE_URL はここでは設定しない。設定されていれば統合テスト（N-8）が
// 実DBに対して走り、未設定なら describe.skip でスキップされる。
// REQUIRE_DB_TESTS=1 のときは DATABASE_URL が無ければ失敗させる（#87）。
// 統合テストは DATABASE_URL が無いと describe.skip で黙ってスキップされるため、
// CI の database ジョブで設定漏れがあっても「全件成功」に見えてしまうのを防ぐ
if (process.env.REQUIRE_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  throw new Error('REQUIRE_DB_TESTS=1 ですが DATABASE_URL が設定されていません。統合テストがスキップされます')
}

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-jwt-secret-please-ignore-0123456789abcdef',
      JWT_EXPIRES_IN: '24h',
      JWT_REFRESH_EXPIRES_IN: '7d',
      NODE_ENV: 'test',
      // 統合テストはアカウント単位のロックアウト（#78）を確かめるため同じ IP から
      // 何度もログインに失敗する。IP 単位のレート制限（本番既定 10回/15分）に
      // 先に当たらないよう、テストでは緩める
      LOGIN_RATE_LIMIT_MAX: '1000',
      // 統合テストは意図的に 401/403/400 を起こすため、アプリのリクエストログが
      // 出力を埋め尽くす。テスト失敗の原因を読み取れるよう fatal だけに絞る
      LOG_LEVEL: 'fatal',
      // 招待・一時パスワードのメール（#89）はプロセス内に貯め、統合テストが中身を確かめる
      MAIL_DRIVER: 'memory',
    },
    include: ['src/**/*.test.ts'],
  },
})
