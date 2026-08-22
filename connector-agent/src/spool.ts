import * as fs from 'node:fs'
import * as path from 'node:path'
import { BackendClient, ApiError, NetworkError } from './api.js'

// ローカルスプール（設計書 §10.3）。
// 実行結果・証跡は「まずディスクに永続化してから送信」する。
// ネット断・プロセス再起動でも結果は消えず、復帰後に再送される。

interface SpoolEntry {
  kind: 'result' | 'artifact'
  jobId: string
  body: unknown
  createdAt: string
}

export class Spool {
  private readonly dir: string
  private readonly deadDir: string
  private seq = 0

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'spool')
    this.deadDir = path.join(dataDir, 'spool-dead')
    fs.mkdirSync(this.dir, { recursive: true })
    fs.mkdirSync(this.deadDir, { recursive: true })
  }

  enqueue(entry: Omit<SpoolEntry, 'createdAt'>): void {
    this.seq += 1
    const file = path.join(this.dir, `${Date.now()}-${String(this.seq).padStart(4, '0')}.json`)
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ ...entry, createdAt: new Date().toISOString() } satisfies SpoolEntry))
    fs.renameSync(tmp, file) // 書きかけファイルを送信対象にしない
  }

  pendingCount(): number {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).length
  }

  /**
   * スプールを古い順に送信する。
   * - 成功: ファイル削除
   * - ネットワークエラー: 中断（次回フラッシュで再送）
   * - 4xx（恒久的拒否）: dead へ退避してログに残す（無限再送でキューを詰まらせない）
   */
  async flush(client: BackendClient): Promise<{ sent: number; dead: number }> {
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .sort()

    let sent = 0
    let dead = 0
    for (const file of files) {
      const fullPath = path.join(this.dir, file)
      let entry: SpoolEntry
      try {
        entry = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as SpoolEntry
      } catch {
        fs.renameSync(fullPath, path.join(this.deadDir, file))
        dead += 1
        continue
      }

      try {
        if (entry.kind === 'result') {
          await client.reportResult(entry.jobId, entry.body)
        } else {
          await client.uploadArtifact(entry.jobId, entry.body)
        }
        fs.unlinkSync(fullPath)
        sent += 1
      } catch (error) {
        if (error instanceof NetworkError) {
          // ネット断: ここで打ち切り、次回フラッシュに委ねる
          break
        }
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          // 恒久的拒否（ジョブが既に回収済み等）。dead へ退避
          console.warn(`スプール項目が拒否されました（${error.status}: ${error.message}）: ${file}`)
          fs.renameSync(fullPath, path.join(this.deadDir, file))
          dead += 1
          continue
        }
        break // 5xx はサーバー側の一時障害とみなし次回へ
      }
    }
    return { sent, dead }
  }
}
