import { AsyncLocalStorage } from 'node:async_hooks'
import type { Prisma } from '@prisma/client'

// リクエスト単位のテナントコンテキスト（SAAS_DECISIONS.md D-01）。
//
// PostgreSQL の RLS はセッション変数 app.tenant_id を見て行を絞り込む。
// この変数はトランザクション内で set_config(..., true) により設定するため、
// 「そのトランザクションのクライアント」を非同期呼び出しの連鎖に沿って
// 持ち回る必要がある。それを AsyncLocalStorage で実現する。
//
// 【なぜグローバル変数ではだめか】
// Node は1プロセスで多数のリクエストを並行処理する。テナントIDをモジュール変数に
// 持つと、await をまたいだ瞬間に別リクエスト（＝別テナント）の値で上書きされ、
// 他社データが見える。AsyncLocalStorage はリクエストごとに独立した保管領域を持つ。

/** 現在のリクエストに紐づくトランザクションクライアント */
export type TxClient = Prisma.TransactionClient

interface TenantStore {
  client: TxClient
  /** テナント横断（提供側ADMIN・ログイン前）で動作しているか。ログ・デバッグ用 */
  bypass: boolean
}

export const tenantStore = new AsyncLocalStorage<TenantStore>()

/** テナントコンテキスト内なら、そのトランザクションクライアントを返す */
export function getTenantClient(): TxClient | undefined {
  return tenantStore.getStore()?.client
}

/** テナント横断モードで動作中かどうか */
export function isRlsBypassed(): boolean {
  return tenantStore.getStore()?.bypass ?? false
}
