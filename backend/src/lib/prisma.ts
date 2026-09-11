import { PrismaClient } from '@prisma/client'
import { config } from './config.js'

// PrismaClient のシングルトンインスタンスを作成
// 開発環境でホットリロード時に複数のインスタンスが作成されるのを防ぐ

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// クエリログは既定で出さない。SQL本文が大量に出て他のログが読めなくなるうえ、
// 将来 Prisma のログ形式が変わった場合に値が混ざるリスクもあるため、
// 明示的に LOG_LEVEL=debug/trace を指定した開発環境でのみ有効にする。
const logLevels: ('query' | 'info' | 'warn' | 'error')[] = config.isDevelopment
  ? config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace'
    ? ['query', 'info', 'warn', 'error']
    : ['warn', 'error']
  : ['error']

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevels,
  })

if (!config.isProduction) {
  globalForPrisma.prisma = prisma
}

// Graceful shutdown は server.ts の disconnectDatabase() で行う。
// process.on('beforeExit') は process.exit() 経由の終了では発火しないため、
// ここでハンドラを登録しても確実な切断にはならない。
