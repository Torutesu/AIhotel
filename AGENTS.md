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
- バックエンドは Express+TypeScript+Prisma（FastAPIへ移行しない）。クラウド固有SDKを追加しない
- ロールは ADMIN / MANAGER / OPERATOR の3種
- 料金ランクは最大40段階、需要レベルはA〜E、週末=金・土（`Hotel.weekendDays` を参照しハードコードしない）
- 価格戦略の重み（稼働率/ADR/競合）は合計100%必須

**API契約**: パスは `/api/v1/<領域>`。レスポンスは `utils/response.ts` / `errorHandler.ts` 経由で
成功 `{success: true, data}` / 失敗 `{success: false, error, errors?}` に統一。独自形式を作らない

**フロントエンド**: API呼び出しは `frontend/lib/api.ts` に集約（コンポーネント内で直接fetchしない）。
モックへのサイレントフォールバック禁止（ローディング＋エラー＋再試行を表示）。UIは日本語

**コミット規約**: Conventional Commits（`feat(backend):` 等）＋件名末尾に対応する指摘ID/タスクID（例 `(C-2, C-3)` `(Task-3)`）。修正単位でコミットを分割

## 未実装領域（Phase 4 — 「実装済み」と報告しないこと）

PMS/OTA連携・スクレイピング・需要予測ML・Claude APIによるAIコメント生成・バッチジョブ・PDF/Excel出力。
対応するDBテーブルとAPIの器は存在し、現在はseedデータで動作している。

運営担当者の意向の記録・差異可視化・継続学習（F-DP-08〜10）はルールベース補正まで実装済み。
MLモデル化・定期再学習バッチは未実装（設計は `docs/継続学習設計.md`）。
学習結果は自動反映せず、MANAGERが承認したセグメントのみ需要予測へ反映する仕様を崩さないこと。

AI予測とレベニュー担当予測の差異分析（F-DP-11〜12）は実装済み（設計は `docs/予測差異分析設計.md`）。
比較は「初期予測どうし」。AI予測は再計算で上書きされるため、担当者予測にAI予測のスナップショットを
焼き込む設計を崩さないこと。乖離が閾値を超えた日の意図・背景は必須で、1件でも欠けたら保存しない。
