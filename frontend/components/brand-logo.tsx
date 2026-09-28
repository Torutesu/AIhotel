import Image from "next/image"
import { cn } from "@/lib/utils"

/** Figmaの共通ロゴ。最終案が決まったらSVGを差し替える。 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <Image src="/hotereve-logo.svg" alt="ホテレベ" width={149} height={44} priority className={cn("h-11 w-[149px] shrink-0 dark:hidden", className)} />
      <Image src="/hotereve-logo-dark.svg" alt="ホテレベ" width={149} height={44} priority className={cn("hidden h-11 w-[149px] shrink-0 dark:block", className)} />
    </>
  )
}
