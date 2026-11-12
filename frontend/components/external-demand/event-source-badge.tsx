"use client"

// イベントの出どころ（D-13）。外部要因エージェントが Web 検索で見つけて登録したイベント（source === "agent"）に
// 「AI収集」のバッジを付け、根拠のページ（sourceUrl）へのリンクを添える。人が登録したイベントには何も出さない。

import { ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { Event as HotelEvent } from "@shared/types"

/** sourceUrl は外部のページ。http(s) 以外（javascript: など）はリンクにしない */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null
  } catch {
    return null
  }
}

export function EventSourceBadge({ event }: { event: Pick<HotelEvent, "name" | "source" | "sourceUrl"> }) {
  if (event.source !== "agent") return null
  const url = safeExternalUrl(event.sourceUrl)
  return (
    <span className="inline-flex items-center gap-1">
      <Badge
        variant="outline"
        className="border-primary/40 bg-primary/5 text-[10px] text-primary"
        title="外部要因エージェントが Web 検索で見つけて登録したイベントです。誤りがあれば編集・削除してください"
      >
        AI収集
      </Badge>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          aria-label={`「${event.name}」の根拠のページを新しいタブで開く`}
        >
          根拠
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </span>
  )
}
