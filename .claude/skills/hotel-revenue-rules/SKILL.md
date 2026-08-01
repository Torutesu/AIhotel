---
name: hotel-revenue-rules
description: このリポジトリ（AIレベニュー管理システム）でコードを追加・変更する際に必ず従うプロジェクト固有の判断基準。新しいAPIルート、Prismaモデル、フロントエンドのデータ取得、コミットを行う前に参照する。
---

# AIレベニュー管理システム 開発ルール

2026-07 の本番化対応（production-readiness ブランチ）で確定した判断基準。
実装とドキュメントが矛盾した場合は**実装が正**とし、ドキュメントを実装に合わせて更新する。

## 技術スタック（確定事項 — 再議論しない）

- バックエンドは **Express + TypeScript + Prisma + PostgreSQL 16**。要件定義書の旧記述にあった FastAPI/Redis/Celery には移行しない。
- クラウド非依存を維持する: DB接続は `DATABASE_URL` 環境変数のみ。AWS/GCP固有のSDK・サービスをコードに持ち込まない（AWS RDS / GCP Cloud SQL のどちらでも動くこと）。
- スキーマ変更は `prisma migrate dev`（マイグレーションファイルをコミット）。`db:push` を本番系フローに使わない。

## セキュリティ・テナント分離（必須・例外なし）

新しいAPIルートを追加するとき:

1. `authenticate` ミドルウェアを必ず適用する（公開してよいのは `/auth/login`・`/auth/refresh`・ヘルスチェックのみ）。
2. hotelId を受け取るエンドポイントには `requireHotelAccess((req) => ...)` を適用する（ADMIN以外は自ホテルのみ）。
3. リクエストは必ず zod スキーマ（`backend/src/lib/validators.ts`）＋ `validate()` で検証する。無検証の `req.body`/`req.query` 直接参照は禁止。
4. 設定変更・作成・削除系は `requireRole('ADMIN', 'MANAGER')` を検討し、`writeAuditLog()`（`services/auditService.ts`）で監査ログを記録する（要件: 全設定変更の記録）。

新しいPrismaモデルを追加するとき:

- 必ず `tenantId` + `tenant` リレーション + `@@index([tenantId])` を持たせる（Tenantが最上位）。
- クエリは hotelId / tenantId で必ず絞り込む。テナント越え防止のため、更新・削除は `updateMany/deleteMany` に hotelId 条件を含めて件数0なら NotFound にするパターンを使う（`settingsService.ts` 参照）。
- `@unique` があるカラムに重複する `@@index` を張らない。

認証まわりの不変条件:

- `JWT_SECRET` は必須・32文字以上。フォールバック値を書かない（未設定なら起動時に throw）。
- リフレッシュトークンはDBに **SHA-256ハッシュのみ** 保存（`hashToken()`）。生トークンを保存しない。
- `/auth/register` はADMIN専用。ユーザーの tenantId はリクエストから受け取らず hotelId の所属テナントから導出する。

## ドメイン仕様の確定値

- 現行実装のロールは `ADMIN / MANAGER / OPERATOR` の3種（STAFF/READONLYは廃止済み）。2026-08-01 MTGで新アカウント体系（本部管理／承認フロー／閲覧のみ＋AIチャット）への再設計が確定している（Issue #11・要件定義書§5）が、移行設計が終わるまで独断でロールを追加・変更しない。
- スマホ対応（レスポンシブ）は行わない（2026-08-01 MTG確定）。
- 料金ランクは**最大40段階**（F-SET-02）。バリデータ・seed・フロントエンドすべて40で統一。
- 週末定義は**金・土**（チェックイン日基準、F-DAILY-02）。`Hotel.weekendDays`（デフォルト `[5, 6]`）を参照し、ハードコードしない。
- 価格戦略の重み（稼働率/ADR/競合追従）は**合計100%必須**（`updateStrategySchema` が強制）。
- 需要レベルは A〜E の5段階（`DemandLevel` enum）。

## API契約

- パスは `/api/v1/<領域>`。レスポンスは成功 `{success: true, data, message?, meta?}` / 失敗 `{success: false, error, errors?: [{field, message}]}` に統一（`utils/response.ts`・`middlewares/errorHandler.ts` を使う。独自形式を作らない）。
- フロントエンドからの呼び出しは `frontend/lib/api.ts` に集約する。コンポーネント内で直接 `fetch` しない。モックへのサイレントフォールバックは禁止（ローディング＋エラー表示＋再試行を出す）。

## 未実装領域（Phase 4 — 器だけ存在）

PMS/OTA連携、スクレイピング、需要予測ML、Claude APIによるAIコメント生成、バッチジョブ、PDF/Excel出力は未実装。対応テーブル（ai_comments, ota_channel_data 等）とAPIは存在し、現在はseedデータで動く。これらを「実装済み」と記述・報告しない。

## コミット・検証

- コミットは修正単位で分け、件名末尾に対応する指摘ID（`(C-2, C-3)` / `(W-4)` / `(Task-3)` 形式）を含める。
- コミット前チェック: `pnpm --filter './*' type-check` → `pnpm --filter backend test` → 必要に応じ `pnpm --filter backend build` / `pnpm --filter frontend build`。backend の type-check には事前に `pnpm --filter backend db:generate` が必要。
- デモ環境: シードは冪等（何度実行してもよい）。アカウントは admin/manager/operator@demo-hotel.example.com、パスワード `Admin1234`。
