import { promises as fs } from 'fs'
import path from 'path'
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { config } from './config.js'

// オブジェクトストレージ抽象化層。
//
// クラウド（AWS S3 / GCP GCS）・BaaS が未確定のため、config.ts と同じ思想で
// 差し替え可能にしておく。呼び出し側（services/reportsService.ts 等）は
// StorageAdapter インターフェースのみに依存し、具体的な保存先を意識しない。
// 実装は local（ローカルディスク）と s3（S3 互換 API — #21）。別の保存先を足すときは createStorage() に case を足す。

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
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
}

/**
 * S3 互換 API への保存実装（#21）。AWS S3・Cloudflare R2・GCS の相互運用 API・MinIO で動く。
 * S3 互換の3操作（Put / Get / Head）だけを使い、クラウド固有の機能には依存しない。
 */
export class S3CompatibleStorage implements StorageAdapter {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
    private readonly keyPrefix = ''
  ) {}

  private objectKey(key: string): string {
    // ローカル実装と同じく、論理キーに親ディレクトリへの参照や先頭のスラッシュを許さない
    if (key.split('/').some((part) => part === '..' || part === '')) {
      throw new Error(`不正なストレージキーです: ${key}`)
    }
    return `${this.keyPrefix}${key}`
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: data, ContentType: contentType })
    )
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))
    if (!res.Body) throw new Error(`オブジェクトの中身がありません: ${key}`)
    return Buffer.from(await res.Body.transformToByteArray())
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))
      return true
    } catch (error) {
      // 存在しないときは 404（NotFound）。権限不足など他のエラーは握りつぶさずに投げる
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404) return false
      throw error
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
    case 's3': {
      // 必須項目は config の superRefine で検証済み
      const clientConfig: S3ClientConfig = {
        region: config.S3_REGION,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! },
        ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      }
      return new S3CompatibleStorage(new S3Client(clientConfig), config.S3_BUCKET!, config.S3_KEY_PREFIX)
    }
    default: {
      const exhaustiveCheck: never = config.STORAGE_DRIVER
      throw new Error(`未対応の STORAGE_DRIVER です: ${exhaustiveCheck}`)
    }
  }
}

export const storage: StorageAdapter = createStorage()
