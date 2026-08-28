import { prisma } from '../lib/prisma.js'

// ヘルスチェック。監視サービスがこの結果でアラートを出せるようにする。
//
// DBを見ないヘルスチェックは、DBが落ちていても「正常」を返してしまい、
// 監視を付けても意味を成さない。実際にクエリを1本投げて確認する。

export interface HealthStatus {
  status: 'ok' | 'degraded'
  services: {
    api: 'healthy'
    database: 'healthy' | 'unhealthy'
  }
  databaseLatencyMs?: number
}

/** DB接続の疎通確認。認証前に呼ばれるためテナントコンテキストは張らない */
export async function checkHealthService(): Promise<HealthStatus> {
  const startedAt = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return {
      status: 'ok',
      services: { api: 'healthy', database: 'healthy' },
      databaseLatencyMs: Date.now() - startedAt,
    }
  } catch {
    // 接続文字列や認証情報が漏れないよう、詳細は返さずログに任せる
    return {
      status: 'degraded',
      services: { api: 'healthy', database: 'unhealthy' },
    }
  }
}
