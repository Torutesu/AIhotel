"use client"

// CSV 取り込みの共通カード（#82 の日次実績から一般化 — #9 競合価格 / #24 OTB でも使う）。
// CSV を読み込み、まず dryRun で検証して件数を見せ、利用者が確認してから取り込む。
// 1行でも不正ならバックエンドは何も書き込まない。

import { useRef, useState, type ReactNode } from "react"
import { Download, FileUp, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { ApiClientError } from "@/lib/api"
import type { CsvParseError } from "@/lib/csv"
import { ROLE_LABELS, canManage } from "@shared/types"

/** 取り込み API が返す要約（各 API に共通の部分） */
export interface ImportSummary {
  total: number
  created: number
  updated: number
  startDate: string
  endDate: string
}

interface CsvImportCardProps<Row> {
  title: string
  description: ReactNode
  templateFileName: string
  template: string
  maxRows: number
  parse: (text: string) => { rows: Row[]; errors: CsvParseError[] }
  submit: (hotelId: string, rows: Row[], dryRun: boolean) => Promise<ImportSummary>
  /** 確認画面の「新規 N・上書き N」の単位（既定は「行」） */
  unit?: string
}

/** File.text() は古いブラウザに無いため FileReader で読む */
function readFileAsText(file: File, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("ファイルを読み込めませんでした"))
    reader.readAsText(file, encoding)
  })
}

/**
 * 日本語版 Excel の「CSV（コンマ区切り）」は Shift_JIS で保存される。
 * UTF-8 として読んで置換文字（U+FFFD）が出たら Shift_JIS で読み直す
 */
async function readCsvText(file: File): Promise<string> {
  const utf8 = await readFileAsText(file, "utf-8")
  if (!utf8.includes("�")) return utf8
  return readFileAsText(file, "shift_jis")
}

/** バックエンドの "rows.<index>.<項目>" をファイル上の行番号（見出しが1行目）へ直す */
function toCsvErrors(fieldErrors: Array<{ field: string; message: string }>): CsvParseError[] {
  return fieldErrors.map((e) => {
    const m = e.field.match(/^rows\.(\d+)/)
    return { line: m ? Number(m[1]) + 2 : 1, message: e.message }
  })
}

export function CsvImportCard<Row>({
  title,
  description,
  templateFileName,
  template,
  maxRows,
  parse,
  submit,
  unit = "行",
}: CsvImportCardProps<Row>) {
  const { hotelId, user } = useAuth()
  const editable = canManage(user?.role)
  const inputRef = useRef<HTMLInputElement>(null)

  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<(ImportSummary & { fileName: string; rows: Row[] }) | null>(null)
  const [errors, setErrors] = useState<CsvParseError[]>([])

  const reset = () => {
    setPreview(null)
    setErrors([])
    if (inputRef.current) inputRef.current.value = ""
  }

  const downloadTemplate = () => {
    // Excel で文字化けしないよう BOM を付ける
    const blob = new Blob(["﻿" + template], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = templateFileName
    // 文書に追加してからクリックしないと、ブラウザによってはファイル名が付かない
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleFile = async (file: File) => {
    if (!hotelId) return
    setPreview(null)
    setErrors([])
    let text: string
    try {
      text = await readCsvText(file)
    } catch {
      toast.error("ファイルを読み込めませんでした")
      return
    }
    const parsed = parse(text)
    if (parsed.errors.length > 0) {
      setErrors(parsed.errors)
      return
    }
    if (parsed.rows.length > maxRows) {
      setErrors([{ line: 1, message: `1回に取り込めるのは${maxRows}行までです（${parsed.rows.length}行あります）。ファイルを分けてください` }])
      return
    }

    setChecking(true)
    try {
      const result = await submit(hotelId, parsed.rows, true)
      setPreview({ fileName: file.name, rows: parsed.rows, ...result })
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.length > 0) {
        setErrors(toCsvErrors(err.fieldErrors))
      } else {
        toast.error(err instanceof ApiClientError ? err.message : "ファイルの確認に失敗しました")
      }
    } finally {
      setChecking(false)
    }
  }

  const handleImport = async () => {
    if (!hotelId || !preview) return
    setImporting(true)
    try {
      const result = await submit(hotelId, preview.rows, false)
      toast.success(`${result.total}行を取り込みました`, {
        description: `新規 ${result.created}${unit}・更新 ${result.updated}${unit}（${result.startDate} 〜 ${result.endDate}）`,
      })
      reset()
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.length > 0) {
        setPreview(null)
        setErrors(toCsvErrors(err.fieldErrors))
      } else {
        toast.error(err instanceof ApiClientError ? err.message : "取り込みに失敗しました")
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editable ? (
          <p className="text-sm text-muted-foreground">取り込みは{ROLE_LABELS.MANAGER}以上のユーザーが実行できます。</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
                <Download className="h-4 w-4" aria-hidden />
                テンプレートをダウンロード
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={checking || importing}
                onClick={() => inputRef.current?.click()}
              >
                {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
                CSV を選択
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label={`${title}の CSV ファイル`}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
            </div>

            {errors.length > 0 && (
              <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">取り込めない行があります（1行も取り込んでいません）</p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                  {errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      {e.line}行目: {e.message}
                    </li>
                  ))}
                </ul>
                {errors.length > 50 && <p className="mt-1 text-xs text-muted-foreground">ほか {errors.length - 50}件</p>}
              </div>
            )}

            {preview && (
              <div className="space-y-3 rounded-lg border p-3 text-sm">
                <p>
                  <span className="font-medium">{preview.fileName}</span>：{preview.rows.length}行（{preview.startDate} 〜 {preview.endDate}）
                </p>
                <p className="text-muted-foreground">
                  新規 {preview.created}{unit}・既存のデータを上書き {preview.updated}{unit}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="gap-2" disabled={importing} onClick={() => void handleImport()}>
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                    取り込む
                  </Button>
                  <Button size="sm" variant="outline" disabled={importing} onClick={reset}>
                    やめる
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
