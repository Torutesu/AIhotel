#!/usr/bin/env node
// ビルド成果物にデモモードの処理が含まれているか検証する。
//
// デモモードは opt-in（NEXT_PUBLIC_DEMO_MODE=true のビルドでのみ有効）。
// 無効時はデモ判定が false にインライン化され、デモ関連のコード（デモ認証情報の表示、
// モックログイン、ダミーデータ）はツリーシェイクで丸ごと削除される。トップレベル定数だけを
// 見ても気づけないため、分岐の内側にしか存在しない文字列の有無で判定する。
//
// 使い方:
//   node scripts/verify-demo-mode.mjs --expect-disabled   # 本番ビルド（変数未設定）: 無効を期待
//   node scripts/verify-demo-mode.mjs                     # デモ用ビルド（=true）: 有効を期待

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// いずれもデモ分岐の内側にしか現れない文字列
const DEMO_ONLY_MARKERS = [
  'メールアドレスまたはパスワードが正しくありません', // mockLogin
  'コンペティターホテルA', // 競合モック
  'デモアカウント', // ログイン画面のデモ認証情報（login-form.tsx）
]

const CHUNK_DIR = join(process.cwd(), '.next', 'static', 'chunks')
const expectDisabled = process.argv.includes('--expect-disabled')

function collectJsFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...collectJsFiles(full))
    else if (entry.endsWith('.js')) files.push(full)
  }
  return files
}

let files
try {
  files = collectJsFiles(CHUNK_DIR)
} catch {
  console.error(`✖ ビルド成果物が見つかりません: ${CHUNK_DIR}`)
  console.error('  先に `pnpm --filter frontend build` を実行してください。')
  process.exit(1)
}

const bundle = files.map((f) => readFileSync(f, 'utf8')).join('\n')
const missing = DEMO_ONLY_MARKERS.filter((m) => !bundle.includes(m))
const enabled = missing.length === 0

if (expectDisabled) {
  if (enabled) {
    console.error('✖ デモモードが無効化されていません（デモ処理がバンドルに残っています）')
    process.exit(1)
  }
  console.log(`✓ デモモードは無効です（${files.length}ファイルを検査）`)
} else {
  if (!enabled) {
    console.error('✖ デモモードが有効になっていません。ビルド時に NEXT_PUBLIC_DEMO_MODE=true が設定されているか確認してください。')
    console.error(`  バンドルに存在しないマーカー: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`✓ デモモードは有効です（${files.length}ファイルを検査）`)
}
