"use client"

import { trackUsage } from "@/lib/api/usage"

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Send, X, MessageSquareText, Loader2 } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError } from "@/lib/api"
import { APP_NAME } from "@/lib/brand"
import { cn } from "@/lib/utils"
import type { Message } from "@shared/types"

type ChatInterfaceProps = { isOpen: boolean; onClose: () => void; onRestoreFocus?: () => void }

export function ChatInterface(props: ChatInterfaceProps) {
  const { hotelId } = useAuth()
  // ホテルを変えたら履歴・入力・実行中の応答を別のセッションに切り替える。
  return <HotelChat key={hotelId ?? "no-hotel"} {...props} />
}

function HotelChat({ isOpen, onClose, onRestoreFocus }: ChatInterfaceProps) {
  const { hotelId, hotel } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [modal, setModal] = useState(true)
  const pendingRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const desktop = window.matchMedia("(min-width: 640px)")
    const sync = () => setModal(!desktop.matches)
    sync()
    desktop.addEventListener("change", sync)
    return () => desktop.removeEventListener("change", sync)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [messages, isTyping, error, isOpen])

  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const attachViewport = useCallback((viewport: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect()
    viewportRef.current = viewport
    if (!viewport || typeof ResizeObserver === "undefined") return
    let previousHeight = viewport.clientHeight
    const observer = new ResizeObserver(() => {
      // 末尾を読んでいた場合は、入力欄や画面の高さが変わっても最新回答を見失わない。
      const wasAtBottom = viewport.scrollHeight - viewport.scrollTop - previousHeight <= 48
      previousHeight = viewport.clientHeight
      if (wasAtBottom) viewport.scrollTop = viewport.scrollHeight
    })
    resizeObserverRef.current = observer
    observer.observe(viewport)
  }, [])

  const send = async (history: Message[]) => {
    if (!hotelId || pendingRef.current) return
    pendingRef.current = true
    setIsTyping(true)
    setError(null)
    try {
      const conversation = history.slice(-20).map(({ role, content }) => ({ role, content }))
      const { reply } = await api.chat(hotelId, conversation)
      void trackUsage("chat_completed", hotelId)
      setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "assistant", content: reply, timestamp: new Date() }])
    } catch (err) {
      setError(err instanceof ApiClientError && err.message ? err.message : "回答を取得できませんでした。もう一度お試しください。")
    } finally {
      pendingRef.current = false
      setIsTyping(false)
    }
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || text.length > 2000 || pendingRef.current || !hotelId || error) return
    const next: Message[] = [...messages, { id: `${Date.now()}-u`, role: "user", content: text, timestamp: new Date() }]
    setMessages(next)
    setInput("")
    void send(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const editFailedQuestion = () => {
    const last = messages.at(-1)
    if (last?.role !== "user") return
    setInput(last.content)
    setMessages(messages.slice(0, -1))
    setError(null)
    inputRef.current?.focus()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }} modal={modal}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus() }}
        onCloseAutoFocus={(event) => { if (onRestoreFocus) { event.preventDefault(); onRestoreFocus() } }}
        onInteractOutside={(event) => event.preventDefault()}
        className="inset-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-xs sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100dvh-3rem))] sm:max-h-[calc(100dvh-3rem)] sm:w-[440px] sm:max-w-[calc(100vw-3rem)] sm:rounded-lg sm:border"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold"><MessageSquareText className="h-5 w-5" aria-hidden />AIチャット</DialogTitle>
            <p className="mt-1 truncate text-xs text-muted-foreground">{hotel?.name ?? "選択中のホテル"}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="AIアシスタントを閉じる"><X className="h-5 w-5" aria-hidden /></Button>
        </header>
        <DialogDescription className="shrink-0 border-b px-5 py-3 text-xs leading-relaxed">
          実データ接続時はホテルの予算・需要予測・分析をもとに回答し、デモでは回答例を表示します。料金や設定は変更しません。
        </DialogDescription>
        <div ref={attachViewport} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {messages.length === 0 && (
            <div className="space-y-4">
              <p className="text-sm font-medium">確認したいことを入力してください</p>
              <div className="space-y-2" aria-label="質問の例">
                {["今月は予算に届きそう？", "価格を上げるべき日は？", "来月の見通しを教えて"].map((question) => (
                  <button key={question} type="button" onClick={() => { setInput(question); inputRef.current?.focus() }} className="min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:border-foreground focus-visible:outline-2">
                    {question}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">質問例を選ぶと入力欄に入ります。必要に応じて編集して送信できます。</p>
            </div>
          )}
          <div role="log" aria-label="会話" aria-live="polite" aria-relevant="additions" className="space-y-5">
            {messages.map((message) => (
              <div key={message.id} className={cn("text-sm leading-7", message.role === "user" && "ml-6 rounded-lg border px-4 py-3")}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{message.role === "user" ? "あなた" : APP_NAME}</p>
                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
              </div>
            ))}
          </div>
          {isTyping && <p role="status" className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />回答を作成しています…</p>}
          {error && <div role="alert" className="mt-5 space-y-3 border-l-2 border-destructive pl-3 text-sm"><p>{error}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void send(messages)} disabled={isTyping}>もう一度送る</Button><Button size="sm" variant="ghost" onClick={editFailedQuestion}>質問を編集</Button></div></div>}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); handleSend() }} className="shrink-0 space-y-2 border-t bg-background px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          <label htmlFor="chat-question" className="sr-only">質問</label>
          <div className="flex items-end gap-2">
            <Textarea id="chat-question" ref={inputRef} rows={2} readOnly={!!error} maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={() => { composingRef.current = false }} placeholder="質問を入力してください..." aria-describedby="chat-input-help" className="max-h-36 min-h-20 flex-1 resize-none overflow-y-auto bg-background shadow-none dark:bg-background" />
            <Button type="submit" size="icon" disabled={!input.trim() || isTyping || !hotelId || !!error} aria-label="メッセージを送信"><Send className="h-4 w-4" aria-hidden /></Button>
          </div>
          <p id="chat-input-help" className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{error ? "再送信するか「質問を編集」を選んでください" : "Enterで送信・Shift+Enterで改行"}</span><span>{input.length.toLocaleString()} / 2,000</span></p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
