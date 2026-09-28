"use client"

import { useState, type ComponentProps } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "./input"
import { cn } from "@/lib/utils"

/** 保存・送信する値は変えず、利用者が選んだ表示方法だけを切り替える */
export function PasswordInput({ className, visibilityLabel = "パスワード", ...props }:
  Omit<ComponentProps<"input">, "type"> & { visibilityLabel?: string }) {
  const [visible, setVisible] = useState(false)
  const label = `${visibilityLabel}を${visible ? "隠す" : "表示"}`
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-11", className)} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        aria-label={label}
        title={label}
        aria-pressed={visible}
        aria-controls={props.id}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  )
}
