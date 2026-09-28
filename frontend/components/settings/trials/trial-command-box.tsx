"use client"

// トライアル管理の「文章で指示」（運営）。
// 入力した文を lib/trial-command.ts の規則で操作に読み替え、内容を見せてから実行する。

import { useState } from "react"
import { Loader2, MessageSquareText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseTrialCommand, type TrialCommand, type TrialCommandResult } from "@/lib/trial-command"
import { TRIAL_KIND_LABELS, type TrialKind, type TrialSummary } from "@shared/types"

interface Props {
  trials: TrialSummary[]
  /** 実行する。失敗したら例外を投げる（表示は呼び出し側） */
  onRun: (command: TrialCommand) => Promise<void>
}

const EXAMPLES = ["○○販売店に30日のIDを発行", "△△ホテルを2週間延長", "○○販売店を停止", "○○販売店のパスワードを再発行"]

export function TrialCommandBox({ trials, onRun }: Props) {
  const [text, setText] = useState("")
  const [result, setResult] = useState<TrialCommandResult | null>(null)
  const [running, setRunning] = useState(false)

  const interpret = () => setResult(parseTrialCommand(text, trials))

  const setKind = (kind: TrialKind) => {
    if (!result?.ok || result.command.type !== "create") return
    const command = { ...result.command, kind }
    setResult({
      ok: true,
      command,
      summary: `「${command.name}」（${TRIAL_KIND_LABELS[kind]}）にトライアルの ID を発行します（期限: ${command.days}日間）`,
    })
  }

  const run = async () => {
    if (!result?.ok) return
    setRunning(true)
    try {
      await onRun(result.command)
      setText("")
      setResult(null)
    } catch {
      // エラーの表示は onRun の側で行う。入力は残してやり直せるようにする
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mb-4 rounded-lg border bg-muted/30 p-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          interpret()
        }}
      >
        <label htmlFor="trial-command" className="sr-only">
          文章で指示
        </label>
        <Input
          id="trial-command"
          className="h-9 flex-1 text-sm"
          placeholder={`文章で指示できます（例: ${EXAMPLES[0]}）`}
          value={text}
          maxLength={200}
          onChange={(e) => {
            setText(e.target.value)
            setResult(null)
          }}
        />
        <Button type="submit" size="sm" variant="secondary" className="h-9 gap-2" disabled={!text.trim()}>
          <MessageSquareText className="h-4 w-4" aria-hidden />
          内容を確認
        </Button>
      </form>

      {!result && (
        <p className="mt-2 text-xs text-muted-foreground">
          例: {EXAMPLES.join(" / ")}（実行する前に内容を確認できます）
        </p>
      )}

      {result && !result.ok && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {result.message}
        </p>
      )}

      {result?.ok && (
        <div role="status" className="mt-3 space-y-2 rounded-md border bg-background p-3 text-sm">
          <p>{result.summary}</p>
          {result.command.type === "create" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              種類:
              {(Object.keys(TRIAL_KIND_LABELS) as TrialKind[]).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={result.command.type === "create" && result.command.kind === kind ? "default" : "outline"}
                  className="h-6 px-2 text-xs"
                  onClick={() => setKind(kind)}
                >
                  {TRIAL_KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setResult(null)} disabled={running}>
              やめる
            </Button>
            <Button
              type="button"
              size="sm"
              variant={result.command.type === "delete" ? "destructive" : "default"}
              className="gap-2"
              onClick={() => void run()}
              disabled={running}
            >
              {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              実行する
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
