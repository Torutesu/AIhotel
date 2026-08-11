# AGENTS.md — コーディングエージェント向けガイド

AIレベニュー管理システム（ホテル収益管理SaaS）。pnpmモノレポ。
このファイルはコードから推測できない規約と必須ルールのみを記載する。機能仕様は `要件定義書.md`、セットアップ手順は `README.md` を参照。

## 構成とコマンド

- `frontend/` Next.js 15 (App Router) + shadcn/ui — Vercelにデプロイ
- `backend/` Express + TypeScript + Prisma + PostgreSQL 16 — コンテナデプロイ（AWS/GCP非依存）
- `shared/` 共通型定義（`@shared/types` / `@hotel-revenue-system/shared`）

```bash
pnpm install                                        # 依存関係（ルートで実行）
docker compose -f docker/docker-compose.dev.yml up -d   # 開発用PostgreSQL
pnpm --filter backend db:generate                   # Prismaクライアント生成（type-checkの前提）
pnpm --filter backend db:migrate && pnpm --filter backend db:seed
pnpm dev                                            # frontend:3000 + backend:3001

# コミット前に必ず全部通すこと:
pnpm --filter './*' type-check && pnpm --filter backend test
pnpm --filter backend build && pnpm --filter frontend build
```

デモログイン: `admin@demo-hotel.example.com` / `Admin1234`（MANAGER/OPERATORは manager@/operator@）

## 必須ルール（例外なし）

**セキュリティ・テナント分離**（マルチテナントSaaS。違反は本番事故になる）:
- 新しいAPIルートには `authenticate` を必ず適用。公開可は `/auth/login`・`/auth/refresh`・ヘルスチェックのみ
- hotelId を受けるルートには `requireHotelAccess(...)`、変更系には `requireRole('ADMIN','MANAGER')` ＋ `writeAuditLog()`
- 入力は必ず `backend/src/lib/validators.ts` の zod スキーマ＋ `validate()` で検証。生の `req.body`/`req.query` 参照禁止
- 新しいPrismaモデルには `tenantId` ＋ tenantリレーション＋ `@@index([tenantId])` を必ず付与。クエリは hotelId/tenantId で絞る
- シークレットのフォールバック値をコードに書かない（JWT_SECRETは32文字以上必須・未設定なら起動時throw）
- リフレッシュトークンはSHA-256ハッシュのみDB保存（`hashToken()`）

**アーキテクチャ境界**（クラウド/BaaS未確定のため。ESLintがエラーにする）:
- backend で `process.env` を直接参照しない → `src/lib/config.ts` の `config` を使う（環境変数・シークレット読み込みの唯一の場所）
- Prismaクライアントの import は `src/services/` と `src/lib/` のみ。controllers/routes はサービス関数を呼ぶ

**スキーマ変更**: `prisma migrate dev` でマイグレーションファイルを生成しコミットする。`db:push` を使わない。`migrate reset` / `--force-reset` / `--accept-data-loss` は禁止（実行前にユーザー確認必須）

**ドメイン確定値**（再議論・変更しない）:
- バックエンドは Express+TypeScript+Prisma（FastAPIへ移行しない）。クラウドはAWS東京リージョン前提だが、AWS SDKの利用は `src/lib/` のアダプタ層に限定（controllers/routes/servicesのビジネスロジックに持ち込まない）
- ロールは ADMIN / MANAGER / OPERATOR の3種
- 需要レベルはA〜E（**UI表示名は「アラート」**）、週末=金・土（`Hotel.weekendDays` を参照しハードコードしない）
- 料金ランクは**部屋タイプ×レート区分（自社/会員/株優/OTA）×ランクコード（65〜0＋★1〜★5の71段階）**。販売料金表（Drive資料）を正とし、価格は100円単位。~~最大40段階~~ は2026/8に撤廃済み（`docs/drive-gap-analysis.md` §2.1）
- 価格戦略の重み付け設定は**撤去済み**（2026/8。同 §3-3）。AI提案への介入は料金ランクの変更で行う

**API契約**: パスは `/api/v1/<領域>`。レスポンスは `utils/response.ts` / `errorHandler.ts` 経由で
成功 `{success: true, data}` / 失敗 `{success: false, error, errors?}` に統一。独自形式を作らない

**フロントエンド**: API呼び出しは `frontend/lib/api.ts` に集約（コンポーネント内で直接fetchしない）。
モックへのサイレントフォールバック禁止（ローディング＋エラー＋再試行を表示）。UIは日本語

**コミット規約**: Conventional Commits（`feat(backend):` 等）＋件名末尾に対応する指摘ID/タスクID（例 `(C-2, C-3)` `(Task-3)`）。修正単位でコミットを分割

## 未実装領域（Phase 4 — 「実装済み」と報告しないこと）

PMSデータ自動取得のクローラ本体（Browser Use/RPA）・OTA/競合スクレイピング・
承認→サイトコントローラー自動書き込み・需要予測ML（4エージェント構成）・確信度による半自動モード・
学習状況(MLOps)画面・Claude APIによるAIコメント生成・バッチジョブ。

**実装済み**（「未実装」と書かないこと）: PDF/Excelレポート出力、PMS取込API（`/api/v1/ingest`）と
オンハンド/残室/セグメントのデータ基盤、キャンセル分析・セグメント別分析・上位下位分析、
オンハンドブッキングカーブ、定員稼働率、料金ランク新モデル、特日/外部要因マスタ。
既存領域はseedデータで動作している。要件のギャップと決定事項は `docs/drive-gap-analysis.md` を参照。
