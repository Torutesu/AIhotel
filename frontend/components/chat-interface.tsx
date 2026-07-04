"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, X, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message } from "@shared/types"

type ChatInterfaceProps = {
  isOpen: boolean
  onClose: () => void
}

export function ChatInterface({ isOpen, onClose }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "こんにちは！ホテル収益管理システムのAIアシスタントです。データ分析や価格設定についてお気軽にご質問ください。",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (!input.trim()) return

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
    setTimeout(() => {
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
      return "現在のADRは¥18,250です。前年同月比+3.2%と好調に推移しています。競合平均が¥17,800であることを考慮すると、さらに5-8%の値上げ余地があると分析しています。"
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
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
    <div className="fixed bottom-24 right-6 w-[420px] h-[600px] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-r from-primary/5 to-primary/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">AIアシスタント</h3>
            <p className="text-xs text-muted-foreground">収益管理をサポート</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed",
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
      </ScrollArea>

      {/* Suggested Questions */}
      {messages.length === 1 && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground mb-2">よくある質問:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => setInput(question)}
                className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-border bg-background">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="質問を入力してください..."
            className="flex-1"
          />
          <Button onClick={handleSend} size="icon" disabled={!input.trim() || isTyping}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
