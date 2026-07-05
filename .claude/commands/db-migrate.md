---
description: Prismaスキーマ変更後のマイグレーション生成・検証・クライアント再生成を一括実行する。引数はマイグレーション名（例 /db-migrate add_payment_table）
argument-hint: <migration-name>
allowed-tools: Bash(pnpm --filter backend *), Bash(npx prisma *), Bash(docker compose *), Bash(nc *), Read, Grep
---

スキーマ変更（backend/prisma/schema.prisma）のマイグレーション化を行ってください。マイグレーション名: $ARGUMENTS

手順:
1. `npx prisma validate`（backend/ で実行）でスキーマ検証
2. 新モデルに `tenantId` + tenantリレーション + `@@index([tenantId])` があるか確認（マルチテナント必須ルール）。無ければ指摘して停止
3. `nc -z localhost 5432` でDB起動確認。起動していなければ `docker compose -f docker/docker-compose.dev.yml up -d` を提案
4. DB起動時: `pnpm --filter backend db:migrate -- --name $ARGUMENTS` でマイグレーション生成
   DB無し時: `npx prisma migrate diff` によるオフラインSQL生成にフォールバックし、その旨を明記
5. `pnpm --filter backend db:generate` → `pnpm --filter backend type-check` で整合確認
6. 生成された migration.sql の内容を要約報告（DROP/データ損失を伴う文があれば警告）

禁止: `migrate reset` / `db push` / `--force-reset` / `--accept-data-loss` は使わない。
