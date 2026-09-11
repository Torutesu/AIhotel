// ESLint フラット設定（F-6）
// next/core-web-vitals + next/typescript を FlatCompat 経由で読み込む。
// eslint-config-next は現状 eslintrc 形式のみを提供しているため FlatCompat が必要。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'public/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // 意図的に握りつぶす catch では変数を省略できるため、未使用引数は _ 始まりを許可する
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
]

export default config
