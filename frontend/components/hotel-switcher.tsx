"use client"

// ホテル切替（X-5 / N-6）
//
// 複数ホテルにアクセスできるユーザー（hotelId が null のユーザー、および運営）
// にだけ表示する。1件しか扱えないユーザーには何も描画しない。
// 候補は GET /hotels が返すホテルそのまま。ADMIN でも自テナント分しか返らない（#62）。
// 選択は URL の ?hotel= に載るため（AuthProvider が解決）、全タブがその選択に追従する。

import { Building2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/components/auth-provider"
import { cn } from "@/lib/utils"

interface HotelSwitcherProps {
  /** ラベルを隠してセレクトのみ表示する（折りたたみサイドバー等） */
  compact?: boolean
  className?: string
}

export function HotelSwitcher({ compact = false, className }: HotelSwitcherProps) {
  const { hotels, hotel, canSwitchHotel, selectHotel } = useAuth()

  // アクセスできるホテルが1件だけのユーザーには切替UIを出さない
  if (!canSwitchHotel || !hotel) return null

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {compact ? (
        <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <Label htmlFor="hotel-switcher" className="whitespace-nowrap text-xs text-muted-foreground">
          ホテル
        </Label>
      )}
      <Select value={hotel.id} onValueChange={selectHotel}>
        <SelectTrigger
          // compact 版はラベルを持たないため id を付けない（同一ページ内のid重複を避ける）
          id={compact ? undefined : "hotel-switcher"}
          className="h-8 min-w-0 flex-1 text-xs"
          aria-label="表示するホテルを切り替える"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hotels.map((h) => (
            <SelectItem key={h.id} value={h.id}>
              {h.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
