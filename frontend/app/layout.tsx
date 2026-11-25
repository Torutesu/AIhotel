import type React from "react"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { Noto_Sans_JP } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { APP_NAME } from "@/lib/brand"
import "./globals.css"

// 日本語UIの字形と行送りを統一する。
const noto = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-noto", display: "swap" })

const description = "料金設定・実績分析・需要予測をひとつに。ホテル収益管理システム「レブスト」。"
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || "a-ihotel-frontend.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(`https://${productionHost}`),
  title: APP_NAME,
  applicationName: APP_NAME,
  description,
  openGraph: {
    title: `${APP_NAME} | ホテル収益管理システム`,
    description,
    siteName: APP_NAME,
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} | ホテル収益管理システム`,
    description,
  },
  appleWebApp: { title: APP_NAME },
  // ログインが必要な管理画面。検索用の公開LPとは区別する。
  robots: { index: false, follow: false },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // middleware.ts が作った CSP の nonce。next-themes はテーマのちらつき防止に
  // インラインスクリプトを出すため、同じ nonce を渡さないと CSP で止まる（#85）。
  // headers() を読むのでページは動的レンダリングになる（nonce はリクエストごとに変わるため必須）
  const nonce = (await headers()).get("x-nonce") ?? undefined

  return (
    // next-themes は描画前に html へ class を付けるため suppressHydrationWarning が必要（U-12）
    <html lang="ja" suppressHydrationWarning>
      <body className={`${noto.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
          <Toaster />
        </ThemeProvider>
        {/* Vercel Insights のスクリプトは Vercel 上にしか存在しない。セルフホストでは
            毎リクエスト 404 になるため、Vercel 環境でのみ読み込む（F-9）。 */}
        {process.env.NEXT_PUBLIC_VERCEL_ENV ? <Analytics /> : null}
      </body>
    </html>
  )
}
