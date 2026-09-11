import { prisma } from '../lib/prisma.js'

// ヘルスチェック用のサービス（C-7）。
// Prisma クライアントの import は src/services と src/lib に限る規約のため、
// app.ts / server.ts はこのサービス関数を経由して DB に触れる。

/**
 * DB 疎通確認。`SELECT 1` を投げて到達性を確認する。
 * 監視系が頻繁に叩くため、失敗しても例外ではなく false を返す。
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

/** プロセス終了時に DB 接続を明示的に閉じる（graceful shutdown 用） */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect()
}
