import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/brand"

// 提供されたロゴ資料の形状をベクターで再現。単色・縦横比固定で表示する。
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label={APP_NAME} className={cn("inline-flex min-h-11 shrink-0 items-center gap-3 text-foreground", className)}>
      <svg aria-hidden="true" viewBox="0 0 40 44" className="h-8 w-auto shrink-0" fill="currentColor">
        <path d="M10 12H15Q17 12 17 14V34A10 10 0 0 1 7 44H2Q0 44 0 42V22A10 10 0 0 1 10 12Z" />
        <path d="M33 0H38Q40 0 40 2V22A10 10 0 0 1 30 32H25Q23 32 23 30V10A10 10 0 0 1 33 0Z" />
      </svg>
      <span aria-hidden="true" className="text-2xl font-medium leading-8 tracking-[-0.025em]">{APP_NAME}</span>
    </span>
  )
}
