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
  // CORS で許可するオリジン。カンマ区切りで複数指定できる（S-10）。
  // Vercel の Preview URL など、本番以外のオリジンを追加で許可するために使う。
  FRONTEND_URL: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
    .pipe(z.array(z.string().url()).nonempty('FRONTEND_URL には少なくとも1つのURLが必要です')),

  // DATABASE_URL は Prisma が直接参照する。型チェックのみの環境では未設定を許すが、
  // NODE_ENV=production では必須にする（下の superRefine — S-7）
  DATABASE_URL: z.string().min(1).optional(),

  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET は必須です。openssl rand -base64 64 で生成してください' })
    .min(32, 'JWT_SECRET は32文字以上である必要があります'),
  // アクセストークンの有効期限。無効化・降格は authenticate が DB で即時に反映するが（#78）、
  // 漏えいしたトークンの悪用可能時間を縮めるため既定は短くする。
  // フロントは期限切れをリフレッシュトークンで透過的に更新する（single-flight — F-2）
  JWT_EXPIRES_IN: z.string().regex(/^\d+[dhms]$/).default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+[dhms]$/).default('7d'),

  // 日次バッチが着地シミュレーションとアラート判定を行う範囲。当月に加えて先の何か月か（#83）
  DAILY_JOB_MONTHS_AHEAD: z.coerce.number().int().min(0).max(12).default(3),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900000),
  // 認証済みリクエストはユーザー単位でカウントするため、IP 単位の 100 では
  // 同一拠点（NAT）からの複数ユーザーで枯渇する。既定を 1000/15分 に引き上げる（S-3）
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  // POST /auth/refresh の IP 単位の上限（15分あたり — #78）。
  // 全体の上限（1000）だけでは、盗んだトークン候補の総当たりを抑えられない
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),

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

  // オブジェクトストレージ抽象化層（lib/storage.ts）。
  // 's3' は S3 互換 API（AWS S3・Cloudflare R2・GCS の相互運用 API・MinIO など）。
  // S3 互換クライアントの利用は AGENTS.md の「クラウド固有 SDK を追加しない」の例外として認められている（#21）
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  // 'local' 時の保存先ディレクトリ。相対パスは backend/ の実行ディレクトリ基準
  STORAGE_LOCAL_DIR: z.string().min(1).default('storage'),
  // 's3' 時の設定。キーは必須でフォールバック値を持たない（未設定なら起動時に失敗させる）
  S3_BUCKET: z.string().min(1).optional(),
  // AWS 以外（R2・GCS・MinIO）はエンドポイントを指定する。AWS なら省略してリージョンだけでよい
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // MinIO などバケット名をパスに含める方式のサービスでは true
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // バケット内のキーの前に付ける接頭辞（1つのバケットを環境ごとに分ける場合など）
  S3_KEY_PREFIX: z.string().default(''),

  // メール送信の抽象化層（lib/mailer.ts — #89, #21）。
  // 'none' は送信しない（一時パスワードは画面で管理者に1回だけ見せる）。
  // 'memory' は送信内容をプロセス内に貯めるだけ（テスト用。本番では使えない）。
  // 'smtp' はどのクラウドでも使える SMTP で送る（#21 の推奨）
  MAIL_DRIVER: z.enum(['none', 'memory', 'smtp']).default('none'),
  // 差出人（例: "AIレベニュー管理 <no-reply@example.com>"）。フォールバック値は持たない
  MAIL_FROM: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  // 465 番（SMTPS）なら true。587 番は STARTTLS を使うので false のまま
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  // 楽天トラベルの空室検索 API（競合価格の取得元 — #9）。アプリ ID を設定したときだけ取得元に登録する。
  // エンドポイントは API の版の変更に備えて差し替えられるようにする
  RAKUTEN_APPLICATION_ID: z.string().min(1).optional(),
  RAKUTEN_TRAVEL_API_URL: z
    .string()
    .url()
    .default('https://app.rakuten.co.jp/services/api/Travel/VacantHotelSearch/20170426'),
  // 楽天ウェブサービスの利用条件（1秒に1回まで）に合わせた間隔
  RAKUTEN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(1000).default(1100),

  // メール本文に載せるログイン画面の URL。未設定なら FRONTEND_URL の先頭を使う
  APP_PUBLIC_URL: z.string().url().optional(),
})
  // 本番では DATABASE_URL 未設定のまま起動させない（S-7）。
  // 開発・テストでは型チェックや単体テストのみを回す用途があるため任意のままにする。
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `STORAGE_DRIVER=s3 では ${key} が必須です` })
        }
      }
    }
    if (env.MAIL_DRIVER === 'smtp') {
      for (const key of ['MAIL_FROM', 'SMTP_HOST'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `MAIL_DRIVER=smtp では ${key} が必須です` })
        }
      }
      // 認証情報は片方だけでは使えない
      if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_PASS'],
          message: 'SMTP_USER と SMTP_PASS は両方設定するか、両方とも未設定にしてください',
        })
      }
    }
    if (env.MAIL_DRIVER === 'memory' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_DRIVER'],
        message: 'MAIL_DRIVER=memory はテスト用です。本番では none か smtp を指定してください',
      })
    }
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
    appPublicUrl: env.APP_PUBLIC_URL ?? env.FRONTEND_URL[0],
    // package.json 経由でのみ設定される値（検証対象外）
    appVersion: process.env.npm_package_version || '1.0.0',
  }
}

export const config = loadConfig()

export type AppConfig = typeof config
