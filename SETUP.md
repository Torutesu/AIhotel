# セットアップガイド

## 初回セットアップ

### 1. 依存関係のインストール

```bash
# ルートディレクトリで実行
npm install
```

### 2. 環境変数の設定

#### Frontend

`frontend/.env.local` を作成：

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

#### Backend

`backend/.env` を作成（`.env.example` を参考に）：

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
```

### 3. 開発サーバーの起動

```bash
# 両方のサーバーを同時に起動
npm run dev

# または個別に起動
npm run dev:frontend  # http://localhost:3000
npm run dev:backend   # http://localhost:3001
```

## プロジェクト構造

```
root/
├── frontend/              # Next.js アプリケーション
│   ├── app/               # App Router ページ
│   ├── components/         # React コンポーネント
│   ├── hooks/             # カスタムフック
│   ├── lib/               # フロントエンド専用ユーティリティ
│   └── public/            # 静的ファイル
│
├── backend/               # Express API サーバー
│   └── src/
│       ├── routes/        # エンドポイント定義
│       ├── controllers/   # リクエスト/レスポンス処理
│       ├── services/      # ビジネスロジック
│       ├── middlewares/   # ミドルウェア
│       ├── db/            # データアクセス層（将来 Prisma など）
│       └── utils/         # バックエンド専用ユーティリティ
│
├── shared/                # 共通コード
│   ├── types/             # 型定義（frontend/backend で共有）
│   └── utils/             # 共通ユーティリティ関数
│
└── docker/                # Docker 設定
    ├── frontend.Dockerfile
    ├── backend.Dockerfile
    └── docker-compose.yml
```

## 型定義の使用

### Frontend から

```typescript
import type { CampaignData, AnalysisSettings } from '@shared/types'
```

### Backend から

```typescript
import type { CampaignData, ApiResponse } from '@hotel-revenue-system/shared/types'
```

## API エンドポイント

すべての API は `/api/v1/` プレフィックスを使用します。

### Hotels
- `GET /api/v1/hotels` - ホテル一覧
- `GET /api/v1/hotels/:id` - ホテル詳細

### Pricing
- `GET /api/v1/pricing` - 価格データ取得
- `GET /api/v1/pricing/:date` - 特定日の価格データ
- `POST /api/v1/pricing` - 価格データ更新

### Analysis
- `GET /api/v1/analysis` - 分析データ取得
- `GET /api/v1/analysis/cross-settings` - クロス分析設定取得

## トラブルシューティング

### 型エラーが発生する場合

```bash
# 型チェックを実行
npm run type-check
```

### モジュール解決エラー

`shared` パッケージが認識されない場合は、再度インストール：

```bash
npm install
```

### ポートが既に使用されている場合

`.env` ファイルでポート番号を変更してください。

## 次のステップ

1. データベース接続の設定（Prisma など）
2. 認証・認可の実装
3. API エンドポイントの実装
4. テストの追加

