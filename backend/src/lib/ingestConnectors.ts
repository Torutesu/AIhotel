import { createHash } from 'node:crypto'
import { readdir, readFile, rename, stat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { config } from './config.js'

// ======================================
// 取得コネクタ（docs/pms-ingest-design.md §A-3 / §B）
//
// 「取得手段ごとの差異」をこの層だけに閉じ込めるための境界。
// 下流（プロファイル駆動の整形 → 取込サービス）は、どの方式で取ってきたかを知らない。
// PMSの提供形態が確定していなくても（§A-0）、ファイルがどこかに出てくる限り
// バックエンドが自分で拾いに行けるようにするのが目的で、人手のアップロードは代替手段にすぎない。
//
// 秘密情報はDBに置かず、connectorConfig には secretRef（キー名）だけを持たせ、
// 実体は config.INGEST_SECRETS から引く（環境変数の読み込みは lib/config.ts のみ）。
// ======================================

export interface FetchedFile {
  /** 表示・ログ用の名前 */
  fileName: string
  /** 取得元の識別子（絶対パス / URL） */
  origin: string
  content: Buffer
  /** 内容のSHA-256。同一ファイルの二重取込を避けるための鍵 */
  checksum: string
}

export const localDirConfigSchema = z.object({
  /** INGEST_INBOX_DIR からの相対サブディレクトリ */
  directory: z.string().trim().min(1).max(200),
  /** 対象ファイル名の正規表現（例 "^CSV\\d{6}HG\\.xlsx$"） */
  filePattern: z.string().trim().min(1).max(200).optional(),
  /**
   * 取込後に .processed/ へ退避するか。
   * 退避しない場合もチェックサム重複で二重取込は起きないが、
   * 走査対象が無限に増えるため常設運用では true を推奨。
   */
  archiveAfterIngest: z.boolean().default(true),
})

export const httpsConfigSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), 'httpsのURLのみ許可します'),
  /** config.INGEST_SECRETS のキー名。値がそのまま Authorization ヘッダになる */
  secretRef: z.string().trim().min(1).max(64).optional(),
  /** 追加ヘッダ（Cookie等）。秘密情報は入れないこと */
  headers: z.record(z.string()).optional(),
  /** レスポンスに付ける名前。拡張子でパーサが決まるため必須 */
  fileName: z.string().trim().min(1).max(200),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
})

export type LocalDirConfig = z.infer<typeof localDirConfigSchema>
export type HttpsConfig = z.infer<typeof httpsConfigSchema>

/** 取得可能なファイル数の上限。誤設定のディレクトリを一度に全部読まないための歯止め */
const MAX_FILES_PER_RUN = 20
/** 1ファイルの上限（取込APIの10MB制限に合わせる） */
const MAX_FILE_BYTES = 10 * 1024 * 1024

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * INGEST_INBOX_DIR 配下に収まる絶対パスへ解決する。
 * `../` を含む設定でルート外へ出ることを防ぐ（設定はDB由来＝信頼できない入力として扱う）。
 */
export function resolveInboxPath(relative: string): string {
  const root = path.resolve(config.INGEST_INBOX_DIR)
  const resolved = path.resolve(root, relative)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`取込ディレクトリの指定が不正です: ${relative}`)
  }
  return resolved
}

/**
 * 監視ディレクトリからファイルを拾う。
 * クローラ / RPA / 共有フォルダ同期 / SFTPマウントのいずれでも、
 * 「ここにファイルを置く」という一点さえ守れば自動で流れる。
 */
export async function fetchFromLocalDir(raw: unknown): Promise<FetchedFile[]> {
  const cfg = localDirConfigSchema.parse(raw)
  const dir = resolveInboxPath(cfg.directory)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    const e = error as NodeJS.ErrnoException
    // 未作成は「まだ何も届いていない」と同じ扱い。運用開始前にエラーを出し続けない
    if (e.code === 'ENOENT') return []
    throw error
  }

  const pattern = cfg.filePattern ? new RegExp(cfg.filePattern) : null
  const targets = entries
    .filter((name) => !name.startsWith('.'))
    .filter((name) => (pattern ? pattern.test(name) : true))
    .sort()
    .slice(0, MAX_FILES_PER_RUN)

  const files: FetchedFile[] = []
  for (const name of targets) {
    const full = path.join(dir, name)
    const info = await stat(full)
    if (!info.isFile()) continue
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`ファイルが大きすぎます（${name}: ${Math.round(info.size / 1024 / 1024)}MB）`)
    }
    const content = await readFile(full)
    files.push({ fileName: name, origin: full, content, checksum: sha256(content) })
  }
  return files
}

/** 取込に成功したファイルを .processed/ へ退避する（失敗しても取込結果は覆さない） */
export async function archiveLocalFile(origin: string): Promise<void> {
  const dir = path.dirname(origin)
  const archiveDir = path.join(dir, '.processed')
  await mkdir(archiveDir, { recursive: true })
  await rename(origin, path.join(archiveDir, path.basename(origin)))
}

/**
 * 認証付きURLから取得する。サイトコントローラーのレポートDL等を想定。
 * 資格情報は connectorConfig ではなく config.INGEST_SECRETS から引く。
 */
export async function fetchFromHttps(raw: unknown): Promise<FetchedFile[]> {
  const cfg = httpsConfigSchema.parse(raw)

  const headers: Record<string, string> = { ...(cfg.headers ?? {}) }
  if (cfg.secretRef) {
    const secret = config.INGEST_SECRETS[cfg.secretRef]
    if (!secret) {
      throw new Error(`資格情報 "${cfg.secretRef}" が未設定です（INGEST_SECRETS を確認してください）`)
    }
    headers.Authorization = secret
  }

  const response = await fetch(cfg.url, {
    headers,
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`取得に失敗しました（HTTP ${response.status}）`)
  }

  const content = Buffer.from(await response.arrayBuffer())
  if (content.byteLength > MAX_FILE_BYTES) {
    throw new Error(`ファイルが大きすぎます（${Math.round(content.byteLength / 1024 / 1024)}MB）`)
  }

  return [{ fileName: cfg.fileName, origin: cfg.url, content, checksum: sha256(content) }]
}

export type IngestConnectorKindValue = 'LOCAL_DIR' | 'HTTPS'

/** 方式に応じた取得処理。ここが唯一の分岐点で、下流は方式を意識しない */
export async function fetchByConnector(
  kind: IngestConnectorKindValue,
  connectorConfig: unknown
): Promise<FetchedFile[]> {
  switch (kind) {
    case 'LOCAL_DIR':
      return fetchFromLocalDir(connectorConfig)
    case 'HTTPS':
      return fetchFromHttps(connectorConfig)
  }
}

/** 設定JSONを方式ごとのスキーマで検証する（保存時の入口チェック用） */
export function validateConnectorConfig(kind: IngestConnectorKindValue, raw: unknown): void {
  if (kind === 'LOCAL_DIR') localDirConfigSchema.parse(raw)
  else httpsConfigSchema.parse(raw)
}
