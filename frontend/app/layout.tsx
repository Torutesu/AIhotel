import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

// Inter — OpenAI Sansの代替。単一書体をweightのみで使い分ける（OpenAI Developersスタイル）
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: "ホテレベ",
  description: "ホテレベ - AIホテル収益管理システム",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <Toaster />
        {/* Vercel Insights のスクリプトは Vercel 上にしか存在しない。セルフホストでは
            毎リクエスト 404 になるため、Vercel 環境でのみ読み込む（F-9）。 */}
        {process.env.NEXT_PUBLIC_VERCEL_ENV ? <Analytics /> : null}
      </body>
    </html>
  )
}
