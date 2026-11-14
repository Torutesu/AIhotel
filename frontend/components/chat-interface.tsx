"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, X, Sparkles } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/brand"
import type { Message } from "@shared/types"

const GREETING_ID = "greeting"

type ChatInterfaceProps = {
  isOpen: boolean
  onClose: () => void
}

export function ChatInterface({ isOpen, onClose }: ChatInterfaceProps) {
  const { hotelId } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: GREETING_ID,
      role: "assistant",
      content:
        `こんにちは！${APP_NAME}のAIアシスタントです。このホテルの予算・予測・アラート・分析の集計をもとにお答えします。`,
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

  // 会話のうち、挨拶（最初の固定文）を除いたものを API に送る。長すぎる会話は直近の20件まで
  const send = async (history: Message[]) => {
    if (!hotelId) return
    setIsTyping(true)
    setError(null)
    try {
      const conversation = history
        .filter((m) => m.id !== GREETING_ID)
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }))
      const { reply } = await api.chat(hotelId, conversation)
      setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "assistant", content: reply, timestamp: new Date() }])
    } catch (err) {
      setError(err instanceof ApiClientError && err.message ? err.message : "AI の答えを取得できませんでした")
    } finally {
      setIsTyping(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isTyping) return
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: new Date() }
    const next = [...messages, userMessage]
    setMessages(next)
    setInput("")
    await send(next)
  }

  // onKeyPress は非推奨（React 17+ / DOM 仕様）のため onKeyDown を使う
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const suggestedQuestions = [
    "今月は予算に届きそう？",
    "価格を上げるべき日は？",
    "売上の大きいチャネルは？",
    "来月の見通しを教えて",
  ]

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 md:inset-auto md:bottom-24 md:right-6 w-full md:w-[420px] h-full md:h-[600px] bg-card border-0 md:border border-border rounded-none md:rounded-lg shadow-xs flex flex-col overflow-hidden z-30">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-foreground" />
          </div>
          <div>
            <h3 className="font-heading font-medium tracking-tight">AIアシスタント</h3>
            <p className="text-xs text-muted-foreground">収益管理をサポート</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="AIアシスタントを閉じる">
          <X className="w-5 h-5" aria-hidden />
        </Button>
      </div>

      <p className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
        AI がこのホテルのデータ（予算と着地・30日の推奨・アラート・イベント・分析の集計）だけをもとに答えます。価格の変更はできません。
      </p>

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
          {error && (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" role="alert">
              <p>{error}</p>
              <Button size="sm" variant="outline" onClick={() => send(messages)} disabled={isTyping}>
                もう一度送る
              </Button>
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
            onKeyDown={handleKeyDown}
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
    </div>
  )
}
