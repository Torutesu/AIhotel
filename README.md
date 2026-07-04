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
  - ✅ **複数人数の同時比較**: 1名〜6名まで同時に選択可能
  - ✅ **複数ホテルの同時比較**: Aホテル、Bホテル、Cホテルを同時に表示
  - ✅ **日別価格推移グラフ**: 選択した組み合わせをすべて可視化
  - ✅ **価格差の可視化**: 各組み合わせごとの価格差をバーチャートで表示
  - ✅ **曜日別競合価格比較テーブル**: 複数ホテルを横並びで比較

### 🔍 各種分析
- セグメント別クロス分析
- 需要予測分析
- 市場トレンド分析

### 📄 レポート
- 詳細レポート生成
- PDF/Excelエクスポート
- カスタムレポート設定

### 🎯 キャンペーン管理
- キャンペーン参画データ管理
- キャンペーン効果分析
- OTA連携管理

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
- **Express.js**
- **TypeScript**
- **Node.js 18+**
- **CORS** (Cross-Origin Resource Sharing)
- **Helmet** (セキュリティヘッダー)
- **express-rate-limit** (レート制限)

**ツール:**
- **pnpm** (パッケージマネージャー)
- **pnpm workspaces** (monorepo管理)
- **Docker & Docker Compose** (コンテナ化)
- **Concurrently** (並列実行)

## 前提条件

- **Node.js**: 18.0.0 以上
- **pnpm**: 9.0.0 以上（推奨）
- **Docker**: Docker Compose を使用する場合（オプション）

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

`backend/.env` を作成：

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
```

### 4. 開発サーバーの起動

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

# クリーンアップ
pnpm clean
```

### プロジェクト構造の詳細

#### Frontend (`frontend/`)

```
frontend/
├── app/                    # Next.js App Router ページ
│   ├── layout.tsx         # ルートレイアウト
│   ├── page.tsx           # ホームページ
│   └── globals.css        # グローバルスタイル
├── components/            # React コンポーネント
│   ├── tabs/              # タブコンポーネント
│   │   ├── dashboard-tab.tsx      # ダッシュボード
│   │   ├── pricing-tab.tsx        # ダイナミックプライシング
│   │   ├── daily-analysis-tab.tsx # 日別分析（複数人数・複数ホテル対応）
│   │   ├── analysis-tab.tsx       # 各種分析
│   │   └── reports-tab.tsx        # レポート
│   ├── ui/                # shadcn/ui コンポーネント
│   ├── campaign-participation-manager.tsx
│   ├── chat-interface.tsx
│   ├── main-layout.tsx
│   └── ...
├── hooks/                 # カスタムフック
│   ├── use-mobile.ts
│   └── use-toast.ts
├── lib/                   # フロントエンド専用ユーティリティ
│   └── utils.ts
└── public/                # 静的ファイル
```

#### Backend (`backend/`)

```
backend/
└── src/
    ├── index.ts           # エントリーポイント
    ├── routes/            # エンドポイント定義
    │   ├── hotels.ts
    │   ├── pricing.ts
    │   └── analysis.ts
    ├── controllers/       # リクエスト/レスポンス処理
    │   ├── hotelsController.ts
    │   ├── pricingController.ts
    │   └── analysisController.ts
    ├── services/          # ビジネスロジック
    │   ├── hotelsService.ts
    │   ├── pricingService.ts
    │   └── analysisService.ts
    ├── middlewares/       # ミドルウェア
    │   ├── errorHandler.ts
    │   └── notFoundHandler.ts
    ├── db/                # データアクセス層（将来 Prisma など）
    │   └── prisma/
    └── utils/             # バックエンド専用ユーティリティ
        └── logger.ts
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

### Docker Compose で起動（推奨）

```bash
cd docker
docker-compose up --build
```

これにより、frontend と backend が同時に起動します：

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

### 個別にビルド

```bash
# Frontend
docker build -f docker/frontend.Dockerfile -t hotel-revenue-frontend .

# Backend
docker build -f docker/backend.Dockerfile -t hotel-revenue-backend .
```

### Docker Compose の停止

```bash
cd docker
docker-compose down
```

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

### AWS / その他のクラウド (Backend)

Backend は AWS ECS、Lambda、またはその他のクラウドサービスでデプロイできます。

環境変数の設定例：

```env
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://your-frontend-domain.com
```

## API エンドポイント

すべての API は `/api/v1/` プレフィックスを使用します。

### Hotels

- `GET /api/v1/hotels` - ホテル一覧取得
- `GET /api/v1/hotels/:id` - ホテル詳細取得

### Pricing

- `GET /api/v1/pricing` - 価格データ取得
- `GET /api/v1/pricing/:date` - 特定日の価格データ取得
- `POST /api/v1/pricing` - 価格データ更新

### Analysis

- `GET /api/v1/analysis` - 分析データ取得
- `GET /api/v1/analysis/cross-settings` - クロス分析設定取得

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

- **複数人数の同時比較**: チェックボックスで1名〜6名まで選択可能
- **複数ホテルの同時比較**: Aホテル、Bホテル、Cホテルを同時に選択可能
- **動的なグラフ表示**: 選択した組み合わせに応じてグラフが自動更新
- **価格計算ロジック**: 人数に応じた価格計算（1名: 1.0x, 2名: 1.8x, 3名: 2.4x, 4名: 3.0x, 5名: 3.5x, 6名: 4.0x）

## ライセンス

Private

## サポート

問題が発生した場合は、以下のドキュメントを参照してください：

- `SETUP.md` - セットアップガイド
- `TROUBLESHOOTING.md` - トラブルシューティングガイド
- `VERCEL_SETUP.md` - Vercel デプロイ設定ガイド

または、プロジェクトの Issue を作成してください。
