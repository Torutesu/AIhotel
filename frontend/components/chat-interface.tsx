"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Send, X, Sparkles } from "lucide-react"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { cn } from "@/lib/utils"
import type { Message } from "@shared/types"

type ChatInterfaceProps = {
  isOpen: boolean
  onClose: () => void
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>
}

export function ChatInterface({ isOpen, onClose, returnFocusRef }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "こんにちは！ホテレベのAIアシスタントです。データ分析や価格設定についてお気軽にご質問ください。",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (replyTimer.current) clearTimeout(replyTimer.current) }, [])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isTyping) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsTyping(true)

    // Simulate AI response
    replyTimer.current = setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: getAIResponse(input),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiResponse])
      setIsTyping(false)
    }, 1500)
  }

  const getAIResponse = (query: string): string => {
    const lowerQuery = query.toLowerCase()

    if (lowerQuery.includes("稼働率") || lowerQuery.includes("occupancy")) {
      return "現在の稼働率は82.5%です。前月比-2.1%とやや低下していますが、週末は95%以上を維持しています。平日の稼働率向上のため、ビジネス客向けプロモーションの実施を推奨します。"
    }

    if (lowerQuery.includes("adr") || lowerQuery.includes("平均客室単価")) {
      return "現在のADRは¥18,250です。前年同月比+3.2%と好調に推移しています。競合の価格水準（中央値）が¥17,800であることを考慮すると、さらに5-8%の値上げ余地があると分析しています。"
    }

    if (lowerQuery.includes("価格") || lowerQuery.includes("プライシング") || lowerQuery.includes("料金")) {
      return "ダイナミックプライシング分析によると、4月5日（土）は需要が非常に高いため、現在価格¥24,000から¥26,500への値上げを推奨します。これにより約10.4%の増収が見込まれます。"
    }

    if (lowerQuery.includes("チャネル") || lowerQuery.includes("予約")) {
      return "公式サイトが全体の38.5%を占め、最も重要な予約チャネルとなっています。公式アプリの成長率が+24.8%と突出しており、モバイル戦略の強化が効果を発揮しています。"
    }

    if (lowerQuery.includes("収益") || lowerQuery.includes("売上") || lowerQuery.includes("revenue")) {
      return "今月の室料売上は¥12,450,000で、予算比+8.5%、前年比+12.3%と好調です。ADRの上昇が主な要因で、価格戦略が効果的に機能しています。"
    }

    if (lowerQuery.includes("レポート") || lowerQuery.includes("report")) {
      return "レポートタブから月次レポート、四半期レポート、カスタムレポートを生成できます。PDF、Excel、CSV形式でのエクスポートに対応しています。定期レポートの自動配信設定も可能です。"
    }

    if (lowerQuery.includes("予測") || lowerQuery.includes("forecast")) {
      return "AI予測によると、来月の稼働率は87.0%、ADRは¥18,333、室料売上は¥13,200,000に達する見込みです。地域イベントの開催により需要増加が期待されます。"
    }

    return "ご質問ありがとうございます。ダッシュボード、価格設定、日別分析、各種分析、レポートなど、システムの各機能についてサポートいたします。具体的にどのような情報をお探しですか？"
  }

  // onKeyPress は非推奨（React 17+ / DOM 仕様）のため onKeyDown を使う
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      handleSend()
    }
  }

  const suggestedQuestions = [
    "今月の稼働率は？",
    "価格を上げるべき日は？",
    "最も収益性の高いチャネルは？",
    "来月の予測を教えて",
  ]

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent onCloseAutoFocus={(event) => { if (returnFocusRef) { event.preventDefault(); returnFocusRef.current?.focus() } }} showCloseButton={false} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus() }} className="inset-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 sm:inset-auto sm:bottom-6 sm:right-6 sm:left-auto sm:top-auto sm:h-[min(720px,calc(100dvh-3rem))] sm:w-[420px] sm:max-w-[calc(100vw-3rem)] sm:rounded-lg sm:border">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-foreground" />
          </div>
          <div>
            <DialogTitle className="font-heading font-bold tracking-tight">AIアシスタント</DialogTitle>
            <p className="text-xs text-muted-foreground">収益管理をサポート</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="AIアシスタントを閉じる">
          <X className="w-5 h-5" aria-hidden />
        </Button>
      </div>

      <div className="border-b border-border p-3">
        <SampleDataNotice detail="Claude API との接続が未実装のため、応答は定型のサンプルです。" />
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" ref={scrollAreaRef} role="log" aria-label="会話履歴" aria-live="polite">
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] break-words rounded-lg px-4 py-3 text-sm leading-relaxed",
                  message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )}
              >
                {message.content}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-3">
                <div className="flex gap-1">
                  <div
                    className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <div
                    className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <div
                    className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Suggested Questions */}
      {messages.length === 1 && (
        <div className="max-h-[28dvh] shrink-0 overflow-y-auto px-4 pb-3">
          <p className="text-xs text-muted-foreground mb-2">よくある質問:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => setInput(question)}
                className="min-h-11 text-sm px-3 py-2 rounded-full bg-muted hover:bg-muted/80 transition-colors"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="AIアシスタントへの質問"
            placeholder="質問を入力してください..."
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            size="icon"
            disabled={!input.trim() || isTyping}
            aria-label="メッセージを送信"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </DialogContent>
    </Dialog>
  )
}
