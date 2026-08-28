import { PrismaClient } from '@prisma/client'
import { config } from './config.js'
import { tenantStore, type TxClient } from './tenantContext.js'

// PrismaClient のシングルトンインスタンスを作成
// 開発環境でホットリロード時に複数のインスタンスが作成されるのを防ぐ

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isDevelopment
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  })

if (!config.isProduction) {
  globalForPrisma.prisma = basePrisma
}

// ======================================
// テナントコンテキスト対応プロキシ（SAAS_DECISIONS.md D-01）
// ======================================
//
// リクエストがテナントコンテキスト内なら、そのトランザクションクライアントへ
// 透過的に委譲する。これにより services 側は従来どおり `import { prisma }` のままでよく、
// テナント指定の付け忘れという事故が起きない（付け忘れてもRLSが0件にする）。

export const prisma: PrismaClient = new Proxy(basePrisma, {
  get(target, prop, receiver) {
    const scoped = tenantStore.getStore()?.client
    if (!scoped) {
      // コンテキスト外（起動処理・ログイン前など）。RLS により、
      // app.tenant_id 未設定のクエリは 0 件になる（fail-closed）
      return Reflect.get(target, prop, receiver)
    }

    // すでにリクエスト単位のトランザクション内にいる。Prisma はトランザクションの
    // ネストを許さないため、内側の $transaction は同じトランザクションで実行する
    // （全体が1トランザクションになるだけで、原子性はむしろ強くなる）
    if (prop === '$transaction') {
      return (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: TxClient) => unknown)(scoped)
        }
        throw new Error(
          'テナントコンテキスト内では $transaction の配列形式は使用できません。コールバック形式を使ってください'
        )
      }
    }

    const value = Reflect.get(scoped as object, prop)
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(scoped) : value
  },
}) as PrismaClient

// ======================================
// コンテキストを開始するヘルパー
// ======================================

const txOptions = {
  timeout: config.DB_TRANSACTION_TIMEOUT_MS,
  maxWait: config.DB_TRANSACTION_MAX_WAIT_MS,
}

/**
 * テナントに閉じたコンテキストで処理を実行する。
 * このブロック内の全クエリは、RLS により当該テナントの行しか読み書きできない。
 */
export async function runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return basePrisma.$transaction(async (tx) => {
    // SET LOCAL は値をリテラルで書く必要がありパラメータ化できないため、
    // 関数版の set_config を使う（第3引数 true = トランザクション終了で自動的に消える）
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return tenantStore.run({ client: tx, bypass: false }, fn)
  }, txOptions)
}

/**
 * テナント横断が必要な狭い経路でのみ使う（提供側ADMINの操作、ログイン前のユーザー検索）。
 * 通常のリクエスト処理からは呼ばないこと。
 */
export async function runWithRlsBypass<T>(fn: () => Promise<T>): Promise<T> {
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass', 'on', true)`
    return tenantStore.run({ client: tx, bypass: true }, fn)
  }, txOptions)
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await basePrisma.$disconnect()
})
