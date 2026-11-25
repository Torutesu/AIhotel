import { cn } from "@/lib/utils"
import { APP_NAME, APP_NAME_EN } from "@/lib/brand"

/** 既存の丸印とワードマーク。背景色を持たせず両テーマに追従する。 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label={`${APP_NAME} — ${APP_NAME_EN}`} className={cn("inline-flex min-h-11 shrink-0 items-center gap-3 text-foreground", className)}>
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-current" />
      <span aria-hidden="true" className="flex flex-col gap-0.5">
        <span className="text-2xl font-bold leading-7 tracking-wide">{APP_NAME}</span>
        <span className="text-[11px] font-medium leading-4 tracking-[0.06em] text-muted-foreground">{APP_NAME_EN}</span>
      </span>
    </span>
  )
}
