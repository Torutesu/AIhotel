import dotenv from 'dotenv'
import { z } from 'zod'

// 環境変数の読み込みと検証を行う唯一の場所（要件定義書 §8 データ保存方針）。
//
// クラウド（AWS/GCP）・BaaS（Firebase/Supabase等）が未確定のため、
// シークレットの供給元が変わっても差し替えるのはこのファイルだけで済むようにする。
// 他のモジュールから process.env を直接参照することは ESLint で禁止している。
//
// 将来 AWS Secrets Manager / GCP Secret Manager 等を使う場合は、
// loadConfig() の前段で取得した値を process.env に注入するローダーをここに追加する。

// ESM では import が hoist されるため、エントリポイントで dotenv.config() を
// 呼んでも他モジュールの評価に間に合わない。config を import した時点で読み込む。
dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // DATABASE_URL は Prisma が直接参照する。型チェックのみの環境では未設定を許すが、
  // NODE_ENV=production では必須にする（下の superRefine — S-7）
  DATABASE_URL: z.string().min(1).optional(),

  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET は必須です。openssl rand -base64 64 で生成してください' })
    .min(32, 'JWT_SECRET は32文字以上である必要があります'),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[dhms]$/).default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+[dhms]$/).default('7d'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900000),
  // 認証済みリクエストはユーザー単位でカウントするため、IP 単位の 100 では
  // 同一拠点（NAT）からの複数ユーザーで枯渇する。既定を 1000/15分 に引き上げる（S-3）
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

  // リバースプロキシ／ロードバランサ配下で X-Forwarded-For からクライアント IP を取る設定（S-3）。
  // Express の 'trust proxy' にそのまま渡す。true/false・ホップ数（例 1）・'loopback' 等の文字列を許容。
  // 未設定なら信頼しない（req.ip は直接接続元）。
  TRUST_PROXY: z
    .string()
    .trim()
    .optional()
    .transform((v): boolean | number | string => {
      if (v === undefined || v === '') return false
      if (v === 'true') return true
      if (v === 'false') return false
      if (/^\d+$/.test(v)) return Number(v)
      return v
    }),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  // オブジェクトストレージ抽象化層（lib/storage.ts）。クラウド（S3/GCS）未確定のため
  // 現在は 'local' のみ実装。将来 's3' / 'gcs' を追加する場合もここに列挙するだけでよい
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  // 'local' 時の保存先ディレクトリ。相対パスは backend/ の実行ディレクトリ基準
  STORAGE_LOCAL_DIR: z.string().min(1).default('storage'),
})
  // 本番では DATABASE_URL 未設定のまま起動させない（S-7）。
  // 開発・テストでは型チェックや単体テストのみを回す用途があるため任意のままにする。
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'NODE_ENV=production では DATABASE_URL が必須です',
      })
    }
  })

function loadConfig() {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const details = parsed.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('\n  ')
    // 設定不備のまま起動させない（フォールバック禁止 — C-4 の再発防止）
    throw new Error(`環境変数の検証に失敗しました:\n  ${details}`)
  }
  const env = parsed.data
  return {
    ...env,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    // package.json 経由でのみ設定される値（検証対象外）
    appVersion: process.env.npm_package_version || '1.0.0',
  }
}

export const config = loadConfig()

export type AppConfig = typeof config
