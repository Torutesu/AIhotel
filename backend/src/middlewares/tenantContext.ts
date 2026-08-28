import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken, type JWTPayload } from '../lib/auth.js'
import { runWithTenant, runWithRlsBypass } from '../lib/prisma.js'
import { logger } from '../utils/logger.js'

// リクエスト処理全体を、そのユーザーのテナントに閉じたトランザクションで包む
// （SAAS_DECISIONS.md D-01）。PostgreSQL の RLS はこのトランザクション内に
// 設定されたセッション変数を見てテナントを判定する。
//
// 設計の要点:
// - コンテキストを張れないリクエストは「張らない」。RLS 側が 0 件を返すため、
//   付け忘れは情報漏洩ではなく機能不全として現れる（fail-closed）
// - テナント横断は提供側 ADMIN のみ。ロールを見ずに tenantId の有無だけで
//   判定すると、tenantId が欠けた一般ユーザーが全社を見られてしまう

/** ロールバックさせるための内部シグナル（利用者への応答は既に送信済み） */
class RollbackSignal extends Error {
  constructor() {
    super('rollback')
  }
}

function readUserFromHeader(req: Request): JWTPayload | null {
  const authHeader = req.headers.authorization
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  try {
    return verifyAccessToken(parts[1])
  } catch {
    // 無効なトークンはコンテキストを張らない。認証エラー自体は authenticate が返す
    return null
  }
}

export function tenantContext(req: Request, res: Response, next: NextFunction) {
  const user = readUserFromHeader(req)

  let run: (<T>(fn: () => Promise<T>) => Promise<T>) | null = null
  if (user?.tenantId) {
    const tenantId = user.tenantId
    run = (fn) => runWithTenant(tenantId, fn)
  } else if (user?.role === 'ADMIN') {
    // 提供側ADMIN（tenantId なし）のみテナント横断を許可する
    run = (fn) => runWithRlsBypass(fn)
  }

  if (!run) {
    // 未認証、またはテナントを特定できないユーザー。
    // コンテキストなしで進み、DBアクセスがあれば RLS が 0 件にする
    return next()
  }

  run(
    () =>
      new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (rollback: boolean) => {
          if (settled) return
          settled = true
          if (rollback) reject(new RollbackSignal())
          else resolve()
        }
        // 5xx で終わった場合は書き込みを巻き戻す
        res.on('finish', () => finish(res.statusCode >= 500))
        // クライアント切断など、応答を返しきれなかった場合も巻き戻す
        res.on('close', () => finish(!res.writableEnded))
        next()
      })
  ).catch((err: unknown) => {
    if (err instanceof RollbackSignal) return
    logger.error({ err, path: req.path }, 'テナントコンテキストの実行に失敗しました')
    if (!res.headersSent) next(err)
  })
}
