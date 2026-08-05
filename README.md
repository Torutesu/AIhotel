# ホテル収益管理システム (Hotel Revenue Management System)

AIを活用したホテルの収益管理・価格最適化システムです。需要予測、競合分析、動的価格設定機能を提供します。

## 📋 目次

- [プロジェクト概要](#プロジェクト概要)
- [主な機能](#主な機能)
- [アーキテクチャ](#アーキテクチャ)
- [前提条件](#前提条件)
- [セットアップ](#セットアップ)
- [開発](#開発)
- [ビルド](#ビルド)
- [Docker](#docker)
- [デプロイ](#デプロイ)
- [API エンドポイント](#api-エンドポイント)
- [プロジェクト構造](#プロジェクト構造)
- [トラブルシューティング](#トラブルシューティング)
- [ドキュメント一覧](#ドキュメント一覧)

## プロジェクト概要

このプロジェクトは、ホテルの収益を最大化するためのAI分析システムです。リアルタイムの需要予測、競合ホテルとの価格比較、動的な価格最適化を実現します。

## 主な機能

### 📊 ダッシュボード
- KPI進捗状況の可視化
- ADR（平均室料）推移分析
- 稼働率・RevPARのモニタリング
- 前年比比較

### 💰 ダイナミックプライシング
- AI需要予測に基づく価格最適化
- リアルタイム価格調整
- セグメント別価格設定
- 価格変更履歴の追跡

### 📈 日別分析
- **日別パフォーマンス分析**: 日次データの詳細分析
- **ブッキングカーブグラフ**: 予約状況の時系列可視化
- **曜日別パフォーマンス分析**: 曜日ごとの傾向分析
- **競合ホテルとの価格比較分析**:
  - ✅ **複数人数の同時比較**: 1名／2名／3名以上（実データの1〜3名価格 `price1P`/`price2P`/`price3P`）から複数選択可能
  - ✅ **複数ホテルの同時比較**: 登録済み競合ホテルを同時に表示
  - ✅ **日別価格推移グラフ**: 選択した組み合わせをすべて可視化
  - ✅ **価格差の可視化**: 各組み合わせごとの価格差をバーチャートで表示
  - ✅ **曜日別競合価格比較テーブル**: 複数ホテルを横並びで比較

### 🔍 各種分析
- セグメント別クロス分析
- 需要予測分析
- 市場トレンド分析

### 📄 レポート（Phase 4で実装予定）
- 詳細レポート生成
- PDF/Excelエクスポート
- カスタムレポート設定

### 🎯 キャンペーン管理
- キャンペーン参画データ管理
- キャンペーン効果分析
- OTA連携管理（PMS/OTA本連携・スクレイピングはPhase 4で実装予定。DBスキーマ（`Campaign`等）は用意済み）

## アーキテクチャ

このプロジェクトは **monorepo** 構成で、以下のワークスペースで構成されています：

```
root/
├── frontend/          # Next.js 15 アプリケーション (ポート: 3000)
├── backend/           # Express + TypeScript API サーバー (ポート: 3001)
├── shared/            # 共通型定義・ユーティリティ
└── docker/            # Docker 設定ファイル
```

### 技術スタック

**Frontend:**
- **Next.js 15** (App Router)
- **React 19**
- **TypeScript**
- **Tailwind CSS 4**
- **shadcn/ui** (UIコンポーネントライブラリ)
- **Recharts** (グラフ可視化)
- **Radix UI** (アクセシブルなUIプリミティブ)
- **Lucide React** (アイコン)

**Backend:**
- **Express.js** + **TypeScript**
- **Node.js 18+**
- **Prisma ORM** (`backend/prisma/schema.prisma`)
- **PostgreSQL 16**（マルチテナント構成、全モデルに `tenantId`）
- **JWT認証**（アクセストークン＋リフレッシュトークンローテーション、DBにはSHA-256ハッシュのみ保存）
- **Zod**（リクエストバリデーション）
- **CORS** (Cross-Origin Resource Sharing)
- **Helmet** (セキュリティヘッダー)
- **express-rate-limit** (レート制限、ログインエンドポイントは別途厳格な上限)
- **Vitest**（テスト）

**インフラ（クラウド非依存）:**
- **Frontend**: Vercel
- **Backend**: コンテナ実行（AWS ECS Fargate または GCP Cloud Run のどちらでも可。`docker/backend.Dockerfile`）
- **Database**: マネージドPostgreSQL（AWS RDS または GCP Cloud SQL）。`DATABASE_URL` 環境変数で接続先を切り替えるのみで、特定クラウドSDKには依存しない
- **CI**: GitHub Actions（`.github/workflows/ci.yml`。type-check / test / build を必須ゲートとして実行）

**ツール:**
- **pnpm** (パッケージマネージャー)
- **pnpm workspaces** (monorepo管理)
- **Docker & Docker Compose** (ローカル開発用PostgreSQL、および本番用イメージビルド)
- **Concurrently** (並列実行)

> 補足: 需要予測・バッチ処理（PMS/OTA連携、AIコメント自動生成等）はPhase 4で導入予定。現時点ではRedis/Celery等のジョブキューは未導入で、DBスキーマとAPIの器のみ用意済み（詳細は「API エンドポイント」節末尾を参照）。

## 前提条件

- **Node.js**: 18.0.0 以上
- **pnpm**: 9.0.0 以上（推奨）
- **Docker**: ローカルPostgreSQLの起動に使用（`docker/docker-compose.dev.yml`）

### pnpm のインストール

```bash
npm install -g pnpm
```

## セットアップ

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd hotel-revenue-system
```

### 2. 依存関係のインストール

```bash
# ルートディレクトリで実行
pnpm install
```

これにより、`frontend`、`backend`、`shared` のすべてのワークスペースの依存関係がインストールされます。

### 3. 環境変数の設定

#### Frontend

`frontend/.env.local` を作成：

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

#### Backend

`backend/.env.example` をコピーして `backend/.env` を作成：

```bash
cp backend/.env.example backend/.env
```

最低限、以下を設定する必要があります。

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# ローカル開発（下記手順4のdocker-compose.dev.ymlのPostgresに接続）
DATABASE_URL="postgresql://postgres:password@localhost:5432/hotel_revenue_db?schema=public"

# 必須。32文字未満、または未設定の場合は起動時に例外を投げて即座に停止する
# （backend/src/lib/auth.ts の requireJwtSecret）。以下のコマンドで生成する。
#   openssl rand -base64 64
JWT_SECRET="<openssl rand -base64 64 で生成した値に置き換える>"
```

### 4. データベースの起動・マイグレーション・シード投入

ローカル開発用の PostgreSQL コンテナを起動します（アプリ本体はコンテナ化せず、ホスト側で `pnpm dev` を使う想定）。

```bash
# PostgreSQL コンテナ起動
docker compose -f docker/docker-compose.dev.yml up -d

# マイグレーション適用
pnpm --filter backend db:migrate

# シードデータ投入（テナント・ホテル・料金ランク40段階・ユーザー等）
pnpm --filter backend db:seed
```

シード投入後、以下のアカウントでログインできます（パスワードは全アカウント共通）。

| ロール | メールアドレス | パスワード |
| --- | --- | --- |
| ADMIN | admin@demo-hotel.example.com | Admin1234 |
| MANAGER | manager@demo-hotel.example.com | Admin1234 |
| OPERATOR | operator@demo-hotel.example.com | Admin1234 |

### 5. 開発サーバーの起動

```bash
# frontend と backend を同時に起動
pnpm dev

# または個別に起動
pnpm dev:frontend  # http://localhost:3000
pnpm dev:backend   # http://localhost:3001
```

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001

## 開発

### 利用可能なスクリプト

ルートディレクトリで実行可能なコマンド：

```bash
# 開発サーバー起動（両方）
pnpm dev

# 個別に起動
pnpm dev:frontend
pnpm dev:backend

# ビルド（すべて）
pnpm build
pnpm build:frontend
pnpm build:backend

# 型チェック
pnpm type-check

# リント
pnpm lint

# テスト（backendのVitestスイートを実行）
pnpm test

# クリーンアップ
pnpm clean
```

`backend/` 配下ではPrisma関連の追加スクリプトが利用できます（`pnpm --filter backend <script>`）。

```bash
pnpm --filter backend db:generate     # Prisma Clientの生成
pnpm --filter backend db:migrate      # 開発用マイグレーション作成・適用
pnpm --filter backend db:migrate:prod # 本番用マイグレーション適用（prisma migrate deploy）
pnpm --filter backend db:seed         # シードデータ投入
pnpm --filter backend db:studio       # Prisma Studio（DB GUI）起動
```

### テスト・CI

- バックエンドは **Vitest** でユニットテストを実装（`backend/src/lib/auth.test.ts`、`backend/src/lib/validators.test.ts` 等）。`pnpm test` で実行。
- **GitHub Actions**（`.github/workflows/ci.yml`）が `main` / `production-readiness` ブランチへのpush、および全PRに対して以下を必須ゲートとして実行します。
  1. 依存関係インストール（`pnpm install --frozen-lockfile`）
  2. Prisma Client生成（型チェックに必要）
  3. 全ワークスペースの型チェック（`pnpm --filter './*' type-check`）
  4. バックエンドのテスト（`pnpm --filter backend test`）
  5. バックエンド・フロントエンドのビルド

### プロジェクト構造の詳細

#### Frontend (`frontend/`)

```
frontend/
├── app/                    # Next.js App Router ページ
│   ├── layout.tsx         # ルートレイアウト
│   ├── page.tsx           # ホームページ（認証状態に応じてログイン画面/本体を出し分け）
│   └── globals.css        # グローバルスタイル
├── components/            # React コンポーネント
│   ├── tabs/              # タブコンポーネント
│   │   ├── dashboard-tab.tsx      # ダッシュボード
│   │   ├── pricing-tab.tsx        # ダイナミックプライシング
│   │   ├── daily-analysis-tab.tsx # 日別分析（1〜3名価格の競合比較・複数ホテル対応）
│   │   ├── analysis-tab.tsx       # 各種分析
│   │   ├── reports-tab.tsx        # レポート
│   │   └── ai-summary-tab.tsx     # AIサマリー
│   │   └── settings-tab.tsx       # 設定
│   ├── ui/                # shadcn/ui コンポーネント
│   ├── auth-provider.tsx  # 認証コンテキスト（トークン管理・自動リフレッシュ）
│   ├── login-form.tsx     # ログインフォーム
│   ├── campaign-participation-manager.tsx
│   ├── chat-interface.tsx
│   ├── main-layout.tsx
│   └── ...
├── hooks/                 # カスタムフック
│   ├── use-mobile.ts
│   └── use-toast.ts
├── lib/                   # フロントエンド専用ユーティリティ
│   ├── utils.ts
│   └── api.ts             # バックエンドAPIクライアント（トークン保存・自動リフレッシュ）
└── public/                # 静的ファイル
```

#### Backend (`backend/`)

```
backend/
├── prisma/
│   ├── schema.prisma      # DBスキーマ（Tenant最上位のマルチテナント構成、24モデル）
│   ├── migrations/        # マイグレーション履歴
│   └── seed.ts            # 冪等なシードスクリプト
└── src/
    ├── index.ts           # エントリーポイント（Express設定・ルート登録）
    ├── routes/            # エンドポイント定義
    │   ├── auth.ts
    │   ├── hotels.ts
    │   ├── dashboard.ts
    │   ├── pricing.ts
    │   ├── daily.ts
    │   ├── analysis.ts
    │   └── settings.ts
    ├── controllers/       # リクエスト/レスポンス処理
    │   ├── authController.ts
    │   ├── hotelsController.ts
    │   ├── dashboardController.ts
    │   ├── pricingController.ts
    │   ├── dailyController.ts
    │   ├── analysisController.ts
    │   └── settingsController.ts
    ├── services/          # ビジネスロジック
    │   ├── authService.ts
    │   ├── hotelsService.ts
    │   ├── dashboardService.ts
    │   ├── pricingService.ts
    │   ├── dailyService.ts
    │   ├── analysisService.ts
    │   ├── settingsService.ts
    │   └── auditService.ts
    ├── lib/                # 認証・DB・バリデーション基盤
    │   ├── auth.ts         # JWT発行・検証（requireJwtSecret含む）
    │   ├── prisma.ts       # Prisma Clientシングルトン
    │   └── validators.ts   # Zodスキーマ
    ├── middlewares/       # ミドルウェア
    │   ├── auth.ts         # authenticate / requireRole / requireHotelAccess
    │   ├── validate.ts
    │   ├── errorHandler.ts
    │   └── notFoundHandler.ts
    └── utils/             # バックエンド専用ユーティリティ
        ├── logger.ts       # pino ロガー
        └── response.ts     # ApiResponse ヘルパー
```

#### Shared (`shared/`)

```
shared/
├── types/                 # 共通型定義
│   └── index.ts
└── utils/                 # 共通ユーティリティ関数
    └── index.ts
```

### 型定義の使用

**Frontend から:**

```typescript
import type { CampaignData, AnalysisSettings } from '@hotel-revenue-system/shared/types'
```

**Backend から:**

```typescript
import type { CampaignData, ApiResponse } from '@hotel-revenue-system/shared/types'
```

## ビルド

### 開発ビルド

```bash
# すべてのワークスペースをビルド
pnpm build

# 個別にビルド
pnpm build:frontend
pnpm build:backend
```

### 本番ビルド

```bash
# Frontend
cd frontend
pnpm build

# Backend
cd backend
pnpm build
```

## Docker

`docker/` には用途の異なる3つのファイルがあります。frontend/backend アプリ本体を1つの `docker-compose up` で起動する構成ではない点に注意してください。

| ファイル | 用途 |
| --- | --- |
| `docker/docker-compose.dev.yml` | **開発用**。PostgreSQL 16 コンテナのみを起動する（アプリ本体はホスト側で `pnpm dev` を使う） |
| `docker/backend.Dockerfile` | **本番用**。backend のマルチステージビルド（`prisma migrate deploy` を起動時に実行してからサーバー起動） |
| `docker/frontend.Dockerfile` | **本番用**。frontend（Next.js）のマルチステージビルド |

### 開発用DB起動（推奨）

```bash
docker compose -f docker/docker-compose.dev.yml up -d
docker compose -f docker/docker-compose.dev.yml down
```

### 本番用イメージのビルド（ビルドコンテキストはリポジトリルート）

```bash
# Backend
docker build -f docker/backend.Dockerfile -t hotel-revenue-backend .

# Frontend
docker build -f docker/frontend.Dockerfile -t hotel-revenue-frontend .
```

本番イメージは `DATABASE_URL` / `JWT_SECRET` 等をデプロイ先の環境変数・シークレットマネージャーから注入する前提で、AWS/GCP固有のSDKには依存しません（AWS ECS Fargate + RDS、GCP Cloud Run + Cloud SQL のいずれの構成でも同じイメージが利用可能）。

## デプロイ

### Vercel (Frontend)

#### セットアップ手順

1. **Vercel ダッシュボードで設定**
   - Vercel のダッシュボード（https://vercel.com）にログイン
   - プロジェクトの設定（Settings）を開く
   - **General** セクションを開く
   - **Root Directory** を設定：
     - 「Edit」をクリック
     - 「Override」を選択
     - `frontend` と入力
     - 「Save」をクリック

2. **Build & Development Settings の確認**
   - **Framework Preset**: Next.js（自動検出されるはず）
   - **Build Command**: `pnpm --filter frontend build` または空欄（自動検出）
   - **Output Directory**: `.next` または空欄（自動検出）
   - **Install Command**: `pnpm install --no-frozen-lockfile` または空欄

3. **環境変数の設定**
   - Vercel ダッシュボードで環境変数を設定：
     ```
     NEXT_PUBLIC_BACKEND_URL=<your-backend-url>
     ```

4. **デプロイ**
   - Git にプッシュすると自動デプロイされます
   - または、Vercel CLI を使用：
     ```bash
     vercel --prod
     ```

#### vercel.json の設定

ルートディレクトリの `vercel.json` は以下のようになっています：

```json
{
  "buildCommand": "pnpm --filter frontend build",
  "installCommand": "pnpm install --no-frozen-lockfile",
  "outputDirectory": "frontend/.next"
}
```

**重要**: Vercel のダッシュボードで **Root Directory** を `frontend` に設定する必要があります。`vercel.json` だけでは Root Directory を設定できません（Vercel の制限）。

詳細は `VERCEL_SETUP.md` を参照してください。

### Backend（コンテナ、クラウド非依存）

Backend は `docker/backend.Dockerfile` のイメージを **AWS ECS Fargate** または **GCP Cloud Run** のどちらにもデプロイできます。DBは **AWS RDS** または **GCP Cloud SQL** 等のマネージドPostgreSQLを `DATABASE_URL` で指定するだけで切り替え可能です。

環境変数の設定例：

```env
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://your-frontend-domain.com
DATABASE_URL="postgresql://USER:PASSWORD@<managed-postgres-host>:5432/hotel_revenue_db?schema=public&sslmode=require"
JWT_SECRET="<openssl rand -base64 64 で生成した値>"
```

## API エンドポイント

すべての API は `/api/v1/` プレフィックスを使用し、`/login` と `/refresh` を除き **JWTアクセストークン（`Authorization: Bearer <token>`）による認証が必須**です（`backend/src/middlewares/auth.ts`）。加えて `hotelId` を伴うエンドポイントは `requireHotelAccess` によりテナント・ホテル単位のアクセス制御が適用されます。

成功時のレスポンスは `{ success: true, data, message?, meta? }`、失敗時は `{ success: false, error: string, errors?: [{ field, message }] }` の形式で統一されています（`backend/src/utils/response.ts`, `backend/src/middlewares/errorHandler.ts`）。

### Auth (`backend/src/routes/auth.ts`)

- `POST /api/v1/auth/login` - ログイン（JWTアクセストークン・リフレッシュトークン発行。専用のレート制限あり）
- `POST /api/v1/auth/refresh` - リフレッシュトークンによるアクセストークン再発行（ローテーション）
- `POST /api/v1/auth/register` - ユーザー登録（**ADMIN専用**）
- `POST /api/v1/auth/logout` - ログアウト（該当リフレッシュトークンを無効化）
- `POST /api/v1/auth/logout-all` - 全セッションログアウト
- `GET /api/v1/auth/me` - ログイン中ユーザー情報取得

### Hotels (`backend/src/routes/hotels.ts`)

- `GET /api/v1/hotels` - ホテル一覧取得（ADMINは全件、それ以外は自テナントのみ）
- `GET /api/v1/hotels/:id` - ホテル詳細取得（自ホテル or ADMINのみ）
- `POST /api/v1/hotels` - ホテル作成（ADMIN専用）
- `PUT /api/v1/hotels/:id` - ホテル更新（ADMIN専用）
- `DELETE /api/v1/hotels/:id` - ホテル削除（ADMIN専用）

### Dashboard (`backend/src/routes/dashboard.ts`)

- `GET /api/v1/dashboard/kpi` - 月別KPI取得（`hotelId`, `year`, `month`）
- `GET /api/v1/dashboard/kpi/comparison` - 月初/日付比較（`hotelId`, `year`, `month`, `baseDate`）
- `GET /api/v1/dashboard/alerts` - アラート一覧（`hotelId`）
- `GET /api/v1/dashboard/ai-summary` - AIサマリー取得（`hotelId`, `section`）

### Pricing (`backend/src/routes/pricing.ts`)

- `GET /api/v1/pricing/calendar` - 日別価格カレンダー（`hotelId`, `year`, `month`）
- `GET /api/v1/pricing/strategy` - 価格戦略の重み付け取得（`hotelId`）
- `PUT /api/v1/pricing/strategy` - 価格戦略の重み付け更新（**MANAGER以上**）
- `GET /api/v1/pricing/simulation` - 月間着地シミュレーション取得（`hotelId`, `year`, `month`）

### Daily（日別分析） (`backend/src/routes/daily.ts`)

- `GET /api/v1/daily/booking-curve` - ブッキングカーブ取得（`hotelId`, `date`）
- `GET /api/v1/daily/competitor-prices` - 競合価格取得（`hotelId`, `startDate`, `endDate`。1〜3名価格）

### Analysis（各種分析） (`backend/src/routes/analysis.ts`)

- `GET /api/v1/analysis/monthly` - 年間の月次推移取得（`hotelId`, `year`）
- `GET /api/v1/analysis/competitor` - 競合分析取得（`hotelId`, `startDate`, `endDate`）
- `GET /api/v1/analysis/reviews` - 口コミ評価点取得（`hotelId`。現状はシードデータ、収集バッチは未実装）

### Settings (`backend/src/routes/settings.ts`)

- `GET /api/v1/settings/price-ranks` - 料金ランク一覧取得（`hotelId`。最大40段階）
- `POST /api/v1/settings/price-ranks` - 料金ランク作成（**MANAGER以上**）
- `PUT /api/v1/settings/price-ranks/:id` - 料金ランク更新（**MANAGER以上**）
- `DELETE /api/v1/settings/price-ranks/:id` - 料金ランク削除（**MANAGER以上**）

### Health check（認証不要・`/api/v1`配下ではない）

- `GET /health` - プロセスの死活監視
- `GET /api/health` - APIの死活監視

### 未実装（Phase 4以降）

PMS/OTA連携（取込・書き戻し）、OTAスクレイピング、需要予測MLモデル、Claude APIによるAIコメント自動生成（現状は `ai_comments` テーブルへのシードデータ表示のみ）、バッチジョブ、レポートのPDF/Excel出力、口コミの自動収集は未実装です。DBスキーマ（`Campaign`, `ReviewScore`, `GroupBooking`, `AuditLog` 等）とAPIの器は用意済みで、Phase 4で順次接続します。

## トラブルシューティング

### TypeScript エラーが表示される場合

1. **TypeScript サーバーの再起動**
   - VS Code で `Cmd+Shift+P` (Mac) または `Ctrl+Shift+P` (Windows/Linux)
   - 「TypeScript: Restart TS Server」を選択

2. **ワークスペースの再読み込み**
   - `Cmd+Shift+P` / `Ctrl+Shift+P`
   - 「Developer: Reload Window」を選択

3. **node_modules の再インストール**
   ```bash
   rm -rf node_modules frontend/node_modules backend/node_modules shared/node_modules
   pnpm install
   ```

### モジュール解決エラー

#### `@/lib/utils` が見つからない

- `frontend/lib/utils.ts` が存在することを確認
- `frontend/tsconfig.json` の `paths` 設定を確認
- VS Code の TypeScript サーバーを再起動

#### `@shared/types` が見つからない

- `shared/types/index.ts` が存在することを確認
- `pnpm install` を実行してワークスペースの依存関係をインストール

### ポートが既に使用されている場合

`.env` ファイルでポート番号を変更してください：

**Frontend** (`frontend/.env.local`):
```env
PORT=3002  # デフォルトは 3000
```

**Backend** (`backend/.env`):
```env
PORT=3002  # デフォルトは 3001
```

### Vercel デプロイエラー

#### エラー: "No Next.js version detected"

**原因**: Vercel が `frontend/package.json` を見つけられていない

**解決策**:
1. Vercel ダッシュボードで Root Directory を `frontend` に設定
2. プロジェクトを再デプロイ

詳細は `VERCEL_SETUP.md` を参照してください。

#### エラー: "Cannot install with frozen-lockfile"

**原因**: ロックファイルが古い

**解決策**: `installCommand` に `--no-frozen-lockfile` を追加（既に設定済み）

#### エラー: "pnpm: command not found"

**原因**: Vercel が pnpm を認識していない

**解決策**:
1. Vercel のダッシュボードで **Package Manager** を `pnpm` に設定
2. または、プロジェクトのルートに `.npmrc` があることを確認

### ビルドエラー

```bash
# 型チェックを実行
pnpm type-check

# ビルドを実行
pnpm build
```

エラーの詳細を確認してください。

## 開発のヒント

### 新しいコンポーネントの追加

1. `frontend/components/` にコンポーネントファイルを作成
2. 必要に応じて `shared/types/` に型定義を追加
3. コンポーネントをインポートして使用

### 新しい API エンドポイントの追加

1. `backend/src/routes/` にルートファイルを作成
2. `backend/src/controllers/` にコントローラーを作成
3. `backend/src/services/` にサービスロジックを作成
4. `backend/src/index.ts` にルートを登録

### 共通型定義の追加

`shared/types/index.ts` に型定義を追加すると、frontend と backend の両方で使用できます。

### 日別分析機能の拡張

日別分析タブ（`daily-analysis-tab.tsx`）は以下の機能をサポートしています：

- **複数人数の同時比較**: チェックボックスで1名／2名／3名以上を選択可能
- **複数ホテルの同時比較**: 登録済みの競合ホテルを同時に選択可能
- **動的なグラフ表示**: 選択した組み合わせに応じてグラフが自動更新
- **価格データ**: 人数倍率による計算ではなく、`GET /api/v1/daily/competitor-prices` が返す実データ（1〜3名価格 `price1P`/`price2P`/`price3P`）をそのまま表示

## ドキュメント一覧

| ドキュメント | 内容 |
|-------------|------|
| [要件定義書.md](./要件定義書.md) | 機能要件・非機能要件・未確定事項・課題トレーサビリティ |
| [docs/クライアントMTGアジェンダ_決定事項一覧.md](./docs/クライアントMTGアジェンダ_決定事項一覧.md) | クライアントMTGで確定させる決定事項の一覧＋2026-08-01 MTG結果サマリー |
| [docs/議事録_2026-08-01_クライアントMTG.md](./docs/議事録_2026-08-01_クライアントMTG.md) | 2026-08-01 クライアントMTG議事録（決定事項・TODO・対応Issueへのリンク） |
| [docs/requirements/](./docs/requirements/README.md) | 詳細設計ドキュメント群（アルゴリズム・データ取得・画面設計等）。**必ずREADMEの読み替え表から読むこと** |
| [SETUP.md](./SETUP.md) | セットアップガイド |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | トラブルシューティングガイド |
| [VERCEL_SETUP.md](./VERCEL_SETUP.md) | Vercel デプロイ設定ガイド |
| [AGENTS.md](./AGENTS.md) | コーディングエージェント向け開発ルール |

## ライセンス

Private

## サポート

問題が発生した場合は、以下のドキュメントを参照してください：

- `SETUP.md` - セットアップガイド
- `TROUBLESHOOTING.md` - トラブルシューティングガイド
- `VERCEL_SETUP.md` - Vercel デプロイ設定ガイド

または、プロジェクトの Issue を作成してください。
