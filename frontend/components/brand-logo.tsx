// レベスト（レベニューストリーム）のブランドロゴ
// Figma: Logo ページの Logo / Logo Mark と1:1。
// 形状は 28×28 のビューボックスで定義し、size プロップで等比スケールする。
// 「積み上がる収益（3本のバー）」＋「右上へ抜ける流れ（ドット）」の2要素。
// 無彩色のみ。グラデーション・影・彩色は付けない（禁止事項はFigma参照）。

import { cn } from "@/lib/utils"

type LogoSize = "sm" | "md" | "lg"

/** マークの一辺（px）。ロックアップの文字サイズと組で決まる */
const MARK_PX: Record<LogoSize, number> = { sm: 20, md: 28, lg: 44 }

/** ワードマークのクラス。単一書体・weightのみで階層を作る方針に従う */
const WORDMARK_CLASS: Record<LogoSize, string> = {
  sm: "text-[15px] leading-5",
  md: "text-[20px] leading-7",
  lg: "text-[32px] leading-10",
}

const GAP_CLASS: Record<LogoSize, string> = { sm: "gap-2", md: "gap-2", lg: "gap-3" }

export function BrandMark({
  size = "md",
  inverse = false,
  className,
}: {
  size?: LogoSize
  /** 黒地の上で使う場合に true。地と図の役割を入れ替える */
  inverse?: boolean
  className?: string
}) {
  const px = MARK_PX[size]
  const plate = inverse ? "fill-primary-foreground" : "fill-primary"
  const glyph = inverse ? "fill-primary" : "fill-primary-foreground"

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("flex-shrink-0", className)}
    >
      <rect width="28" height="28" rx="6.5" className={plate} />
      <rect x="5.75" y="16" width="3.5" height="5.5" rx="1.75" className={glyph} />
      <rect x="10.85" y="13.25" width="3.5" height="8.25" rx="1.75" className={glyph} />
      <rect x="15.95" y="10.5" width="3.5" height="11" rx="1.75" className={glyph} />
      <circle cx="21.6" cy="8.05" r="2.15" className={glyph} />
    </svg>
  )
}

export function BrandLogo({
  size = "md",
  inverse = false,
  /** h1 として描画するか（画面内で1つだけ true にする） */
  asHeading = false,
  className,
}: {
  size?: LogoSize
  inverse?: boolean
  asHeading?: boolean
  className?: string
}) {
  const Wordmark = asHeading ? "h1" : "span"

  return (
    <div className={cn("flex min-w-0 items-center", GAP_CLASS[size], className)}>
      <BrandMark size={size} inverse={inverse} />
      <Wordmark
        className={cn(
          "truncate font-heading font-medium tracking-tight",
          WORDMARK_CLASS[size],
          inverse ? "text-primary-foreground" : "text-sidebar-foreground",
        )}
      >
        レベスト
      </Wordmark>
    </div>
  )
}
