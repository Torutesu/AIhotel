// API 中継（app/api/[...path]/route.ts）がバックエンドに到達できなかったことを、
// ブラウザ側の API クライアント（lib/api/client.ts）へ伝えるレスポンスヘッダー。
//
// 中継は到達できないときも API 契約どおりの JSON（502）を返すため、ステータスや本文だけでは
// バックエンド自身が返したエラーと区別できない。デモモードのフォールバックは
// 「バックエンドに到達できないとき」だけ発動する決まりなので、このヘッダーで判定する。
// 中継は上流の同名ヘッダーを捨てるため、このヘッダーを付けられるのは中継だけ。
//
// サーバー（ルートハンドラ）とクライアントの両方から読むため "use client" を付けない。

export const BACKEND_UNREACHABLE_HEADER = "x-backend-unreachable"

/** 中継が「バックエンドに到達できない」と返したレスポンスか */
export function isBackendUnreachableResponse(res: Response): boolean {
  return res.headers.get(BACKEND_UNREACHABLE_HEADER) === "1"
}
