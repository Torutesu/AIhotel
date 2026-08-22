import { promises as fs } from 'fs'
import path from 'path'
import { config } from './config.js'

// オブジェクトストレージ抽象化層。
//
// クラウド（AWS S3 / GCP GCS）・BaaS が未確定のため、config.ts と同じ思想で
// 差し替え可能にしておく。呼び出し側（services/reportsService.ts 等）は
// StorageAdapter インターフェースのみに依存し、具体的な保存先を意識しない。
// 将来 S3/GCS を追加する場合は createStorage() に case を足すだけで済む。

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
  /** 保持期限切れスナップショットの削除用（存在しないキーはエラーにしない） */
  delete(key: string): Promise<void>
}

/**
 * ローカルディスクへの保存実装（デフォルト・唯一の実装）。
 * key はスラッシュ区切りの論理パス（例: reports/demo-hotel-001/2026-7.xlsx）。
 */
class LocalDiskStorage implements StorageAdapter {
  constructor(private readonly baseDir: string) {}

  private resolveKeyPath(key: string): string {
    // パストラバーサル対策: 論理キーが baseDir の外に出ないことを保証する
    const resolved = path.resolve(this.baseDir, key)
    const normalizedBase = path.resolve(this.baseDir) + path.sep
    if (!resolved.startsWith(normalizedBase)) {
      throw new Error(`不正なストレージキーです: ${key}`)
    }
    return resolved
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = this.resolveKeyPath(key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, data)
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKeyPath(key))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKeyPath(key))
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKeyPath(key))
    } catch (error) {
      // 存在しないキーの削除は冪等に成功扱いとする
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

function createStorage(): StorageAdapter {
  const baseDir = path.isAbsolute(config.STORAGE_LOCAL_DIR)
    ? config.STORAGE_LOCAL_DIR
    : path.resolve(process.cwd(), config.STORAGE_LOCAL_DIR)

  switch (config.STORAGE_DRIVER) {
    case 'local':
      return new LocalDiskStorage(baseDir)
    // 将来対応:
    // case 's3': return new S3Storage(...)
    // case 'gcs': return new GcsStorage(...)
    default: {
      const exhaustiveCheck: never = config.STORAGE_DRIVER
      throw new Error(`未対応の STORAGE_DRIVER です: ${exhaustiveCheck}`)
    }
  }
}

export const storage: StorageAdapter = createStorage()
