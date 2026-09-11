"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Send, X, Sparkles, Plus, History, Check, XCircle, AlertCircle, RefreshCw, Loader2, BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth-provider"
import {
  api,
  ApiClientError,
  type ChatAction,
  type ChatCitation,
  type ChatConversationSummary,
  type ChatTool,
} from "@/lib/api"

type ChatInterfaceProps = {
  isOpen: boolean
  onClose: () => void
}

/** 画面表示用のメッセージ。error はAPIエラー（再試行付き）の吹き出し */
type UiMessage = {
  id: string
  role: "user" | "assistant" | "error"
  content: string
  citations?: ChatCitation[]
  actions?: ChatAction[]
  llmProvider?: string | null
  llmModel?: string | null
  /** error のとき: 再送する発言 */
  retryContent?: string
}

const GREETING: UiMessage = {
  id: "greeting",
  role: "assistant",
  content:
    "こんにちは！AIアシスタントです。推奨ランクの理由説明・要因の評価・基礎資料の引用に加え、イベント登録や採否の記録も会話から行えます。",
}

/** バックエンドのツール名 → 「できること」の短い表示名。未知のツールは説明文の先頭を使う */
const TOOL_LABELS: Record<string, string> = {
  get_pricing_overview: "価格の概況",
  explain_recommendation: "推奨の説明",
  get_daily_digest: "今日の要点",
  get_factor_scorecard: "要因評価",
  search_knowledge: "基礎資料の引用",
  register_event: "登録",
  record_decision: "採否",
  adjust_factor: "係数調整",
  ignore_competitor_soldout: "競合満室の除外",
}

function toolLabel(tool: ChatTool): string {
  return TOOL_LABELS[tool.name] ?? tool.description.split(/[。（(]/)[0].slice(0, 12)
}

function capabilitiesLine(tools: ChatTool[]): string | null {
  if (tools.length === 0) return null
  const uniq = (list: ChatTool[]) => Array.from(new Set(list.map(toolLabel)))
  const read = uniq(tools.filter((t) => !t.write))
  const write = uniq(tools.filter((t) => t.write))
  const parts = [read.join("・")]
  if (write.length > 0) parts.push(write.join("・"))
  return `できること: ${parts.filter(Boolean).join(" / ")}`
}

function formatConversationDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

const suggestedQuestions = ["今日決めるべき日は？", "今週末の推奨ランクの理由は？", "祝日の係数は効いている？", "ガードレールの考え方を教えて"]

export function ChatInterface({ isOpen, onClose }: ChatInterfaceProps) {
  const { hotelId } = useAuth()
  const [messages, setMessages] = useState<UiMessage[]>([GREETING])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [tools, setTools] = useState<ChatTool[]>([])
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // 開いたときにこのロールで使えるツールを取得し「できること」を表示する
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    api
      .chatTools()
      .then((list) => {
        if (!cancelled) setTools(list)
      })
      .catch(() => {
        if (!cancelled) setTools([])
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
    const target = viewport ?? scrollAreaRef.current
    if (target) {
      target.scrollTop = target.scrollHeight
    }
  }, [messages, isTyping])

  const send = useCallback(
    async (content: string, options: { appendUserMessage: boolean }) => {
      const text = content.trim()
      if (!text || !hotelId) return
      if (options.appendUserMessage) {
        setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text }])
      }
      setIsTyping(true)
      try {
        const reply = await api.sendChatMessage({
          hotelId,
          content: text,
          ...(conversationId ? { conversationId } : {}),
        })
        setConversationId(reply.conversationId)
        setMessages((prev) => [
          ...prev,
          {
            id: reply.message.id,
            role: "assistant",
            content: reply.message.content,
            citations: reply.message.citations ?? [],
            actions: reply.message.actions ?? [],
            llmProvider: reply.message.llmProvider,
            llmModel: reply.message.llmModel,
          },
        ])
      } catch (err) {
        // APIキー未設定（400）などはバックエンドの日本語メッセージをそのまま表示する
        const message = err instanceof ApiClientError ? err.message : "応答の取得に失敗しました"
        setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "error", content: message, retryContent: text }])
      } finally {
        setIsTyping(false)
      }
    },
    [hotelId, conversationId]
  )

  const handleSend = async () => {
    if (!input.trim() || isTyping) return
    const text = input
    setInput("")
    await send(text, { appendUserMessage: true })
  }

  const handleRetry = async (message: UiMessage) => {
    if (!message.retryContent || isTyping) return
    setMessages((prev) => prev.filter((m) => m.id !== message.id))
    await send(message.retryContent, { appendUserMessage: false })
  }

  const handleNewConversation = () => {
    setConversationId(null)
    setMessages([GREETING])
    setInput("")
    inputRef.current?.focus()
  }

  const loadHistory = useCallback(async () => {
    if (!hotelId) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      setConversations(await api.chatConversations(hotelId))
    } catch (err) {
      setHistoryError(err instanceof ApiClientError ? err.message : "履歴の取得に失敗しました")
    } finally {
      setHistoryLoading(false)
    }
  }, [hotelId])

  const openConversation = async (id: string) => {
    if (!hotelId) return
    setLoadingConversation(true)
    try {
      const conv = await api.chatConversation(id, hotelId)
      setConversationId(conv.id)
      setMessages(
        conv.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations ?? [],
          actions: m.actions ?? [],
          llmProvider: m.llmProvider,
          llmModel: m.llmModel,
        }))
      )
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "会話の読み込みに失敗しました"
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "error", content: message }])
    } finally {
      setLoadingConversation(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter で送信、Shift+Enter で改行（日本語入力の変換確定は除外）
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) return null

  const capabilities = capabilitiesLine(tools)

  return (
    <div className="fixed inset-0 md:inset-auto md:bottom-24 md:right-6 w-full md:w-[420px] h-full md:h-[600px] bg-card border-0 md:border border-border rounded-none md:rounded-lg shadow-xs flex flex-col overflow-hidden z-30">
      {/* Header */}
      <div className="border-b border-border bg-muted/50">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <h3 className="font-heading font-medium tracking-tight">AIアシスタント</h3>
              <p className="text-xs text-muted-foreground">収益管理をサポート</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <DropdownMenu onOpenChange={(open) => open && loadHistory()}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 h-8 px-2" disabled={!hotelId} title="過去の会話">
                  <History className="w-4 h-4" />
                  <span className="text-xs">履歴</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
                <DropdownMenuLabel className="text-xs">過去の会話</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {historyLoading ? (
                  <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    読み込み中...
                  </div>
                ) : historyError ? (
                  <div className="px-2 py-2 space-y-1.5">
                    <p className="text-xs text-destructive">{historyError}</p>
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={loadHistory}>
                      <RefreshCw className="w-3 h-3" />
                      再試行
                    </Button>
                  </div>
                ) : conversations.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">まだ会話はありません</p>
                ) : (
                  conversations.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      className={cn("flex flex-col items-start gap-0.5", c.id === conversationId && "bg-accent")}
                      onSelect={() => openConversation(c.id)}
                    >
                      <span className="text-sm truncate w-full">{c.title || "（無題の会話）"}</span>
                      <span className="text-[10px] text-muted-foreground">{formatConversationDate(c.updatedAt)}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" className="gap-1.5 h-8 px-2" onClick={handleNewConversation} title="新しい会話">
              <Plus className="w-4 h-4" />
              <span className="text-xs">新しい会話</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        {capabilities && <p className="px-4 pb-2.5 text-[11px] leading-snug text-muted-foreground">{capabilities}</p>}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {loadingConversation && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              会話を読み込んでいます...
            </div>
          )}
          {messages.map((message) => {
            if (message.role === "error") {
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed bg-destructive/10 border border-destructive/30 text-foreground space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                    {message.retryContent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={isTyping}
                        onClick={() => handleRetry(message)}
                      >
                        <RefreshCw className="w-3 h-3" />
                        再試行
                      </Button>
                    )}
                  </div>
                </div>
              )
            }
            const isUser = message.role === "user"
            return (
              <div key={message.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] space-y-1", isUser ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words",
                      isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    )}
                  >
                    {message.content}
                  </div>
                  {!isUser && message.citations && message.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {message.citations.map((c) => (
                        <Badge
                          key={c.id}
                          variant={c.scope === "tenant" ? "secondary" : "outline"}
                          className="gap-1 text-[10px] font-normal max-w-full"
                          title={c.label ?? c.path}
                        >
                          <BookOpen className="w-3 h-3 shrink-0" />
                          <span className="text-muted-foreground shrink-0">出典</span>
                          <span className="truncate">{c.label ?? c.path}</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                  {!isUser && message.actions && message.actions.length > 0 && (
                    <ul className="space-y-1 pt-0.5">
                      {message.actions.map((a, idx) => (
                        <li
                          key={`${a.tool}-${idx}`}
                          className={cn("flex items-start gap-1.5 text-xs", a.ok ? "text-foreground" : "text-destructive")}
                        >
                          {a.ok ? (
                            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[color:var(--positive)]" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          )}
                          <span className="break-words">{a.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!isUser && (message.llmProvider || message.llmModel) && (
                    <p className="text-[10px] text-muted-foreground">
                      {[message.llmProvider, message.llmModel].filter(Boolean).join(" / ")}
                    </p>
                  )}
                </div>
              </div>
            )
          })}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
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
                onClick={() => {
                  setInput(question)
                  inputRef.current?.focus()
                }}
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
        <div className="flex gap-2 items-end">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hotelId ? "質問を入力（Shift+Enter で改行）..." : "ホテル情報を読み込んでいます..."}
            rows={1}
            disabled={!hotelId}
            className="flex-1 min-h-10 max-h-32 resize-none text-sm"
          />
          <Button onClick={handleSend} size="icon" disabled={!input.trim() || isTyping || !hotelId}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
