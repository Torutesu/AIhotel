import tsParser from '@typescript-eslint/parser'

// アーキテクチャ境界を強制する Lint 設定。
// クラウド・BaaS（AWS/GCP/Firebase/Supabase等）が未確定のため、
// 差し替え時の影響範囲を config.ts と services/ に閉じ込めることが目的。
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts', 'prisma/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // 環境変数の直接参照を禁止（供給元が変わっても config.ts だけ直せば済むようにする）
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="process"][property.name="env"]',
          message: 'process.env を直接参照せず、lib/config.ts の config を使ってください（設定読み込み層の一元化）',
        },
      ],
    },
  },
  {
    // Prisma クライアント実体の import を services/ と lib/ に限定
    // （DB を差し替える場合の変更箇所を services 層に閉じ込める）
    files: ['src/**/*.ts'],
    ignores: ['src/services/**', 'src/lib/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/prisma', '**/lib/prisma.js'],
              message: 'DBアクセス（prisma クライアント）は services 層からのみ行ってください。controllers/routes はサービス関数を呼ぶこと',
            },
          ],
        },
      ],
    },
  },
  {
    // 環境変数を直接扱ってよい例外: 設定読み込み層そのもの、テスト、seed
    files: ['src/lib/config.ts', 'src/**/*.test.ts', 'prisma/seed.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]
