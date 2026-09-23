"use client"

// ルートレイアウト自体が描画できないときの最後のエラー画面（#91）。
// レイアウト（テーマ・フォント）に依存しないよう、html と body を自前で出し、スタイルも最小限にする。

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div role="alert" style={{ textAlign: "center" }}>
          <p>画面を表示できませんでした。</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "6px 16px" }}>
            再試行
          </button>
        </div>
      </body>
    </html>
  )
}
