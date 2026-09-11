"use client"

// サンプル表示（未接続）の共通バッジ／バナー（U-7）
// バックエンドがまだ無い、あるいは接続していないセクションは必ずこれを先頭に置き、
// 表示している数値が実データではないことを明示する。注記なしのモック表示を残さない。

import { FlaskConical } from "lucide-react"
import { cn } from "@/lib/utils"

interface SampleDataNoticeProps {
  /** 何が未接続なのかの補足（例: 「PMS/OTA連携が未実装のため」） */
  detail?: string
  /** バッジのみのコンパクト表示（カードヘッダー内など） */
  compact?: boolean
  className?: string
}

const LABEL = "サンプル表示（未接続）"

export function SampleDataNotice({ detail, compact = false, className }: SampleDataNoticeProps) {
  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning",
          className,
        )}
        title={detail}
      >
        <FlaskConical className="h-3 w-3" aria-hidden />
        {LABEL}
      </span>
    )
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning",
        className,
      )}
    >
      <FlaskConical className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">{LABEL}</span>
        <span className="ml-1">
          {detail ?? "このセクションの数値は画面確認用のサンプルで、バックエンドには接続していません。"}
        </span>
      </p>
    </div>
  )
}
