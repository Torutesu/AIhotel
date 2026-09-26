import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { ApiError } from './errorHandler.js'

/**
 * フロントエンドの中継（frontend/app/api/[...path]/route.ts）がバックエンドへの要求に付けるヘッダー。
 * 名前は frontend/lib/proxy-auth.ts と揃える
 */
export const PROXY_AUTH_HEADER = 'x-proxy-auth'

/**
 * 中継を通った要求だけを受け付ける（R-2-3）。
 *
 * Vercel から呼ぶ構成ではバックエンドがインターネットから直接届く。直接呼ばれると
 * X-Forwarded-For を偽装でき、ログイン回数の制限と監査ログの IP がずれる。
 * 中継と共有する秘密の値（PROXY_SHARED_SECRET）をヘッダーで受け取り、一致しない要求を拒否する。
 *
 * 秘密の値が未設定なら何もしない（受け付けをネットワークで絞る構成のため）。
 * ヘルスチェックは監視やロードバランサが直接叩くので対象外にする。
 * レートリミットより前に置き、中継を通らない要求がリミットの枠を消費しないようにする。
 */
export function requireProxySecret(secret: string | undefined, exemptPaths: ReadonlySet<string>) {
  if (!secret) {
    return (_req: Request, _res: Response, next: NextFunction) => next()
  }
  const expected = Buffer.from(secret)

  return (req: Request, _res: Response, next: NextFunction) => {
    if (exemptPaths.has(req.originalUrl.split('?')[0])) return next()

    const header = req.headers[PROXY_AUTH_HEADER]
    const actual = Buffer.from((Array.isArray(header) ? header[0] : header) ?? '')
    // 長さが違うと timingSafeEqual は例外になるので先に比べる（長さは秘密ではない）
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      next(new ApiError(403, 'このエンドポイントには直接アクセスできません'))
      return
    }
    next()
  }
}
