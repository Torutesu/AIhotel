## 概要

<!-- 何を・なぜ変えたか。対応する所見ID / タスクID（例 S-1, U-4）を書く -->

## 変更内容

-

## 確認したこと

- [ ] `pnpm --filter './*' type-check`
- [ ] `pnpm --filter './*' lint`
- [ ] `pnpm --filter backend test`
- [ ] `pnpm --filter backend build && pnpm --filter frontend build`
- [ ] スキーマ変更がある場合、マイグレーションファイルをコミットした
- [ ] 新規ルートに `authenticate` / `requireHotelAccess` / zod `validate()` / 変更系は `requireRole` + `writeAuditLog()` を適用した
- [ ] フロントエンドの API 呼び出しは `frontend/lib/api.ts` 経由で、モックへのサイレントフォールバックがない

## 画面の変更がある場合

<!-- スクリーンショット -->
