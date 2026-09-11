#!/bin/sh
# Backend container entrypoint.
# MIGRATE_ON_START=true のときだけマイグレーションを適用してから起動する。
# 複数レプリカ構成では、マイグレーションは別ジョブで 1 回だけ実行し、この変数は未設定にする。
set -eu

if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] applying migrations (MIGRATE_ON_START=true)"
  npx prisma migrate deploy
fi

exec node dist/index.js
