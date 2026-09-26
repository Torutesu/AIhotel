#!/bin/sh
# Backend container entrypoint.
#
#   （引数なし）       API サーバーを起動する
#   migrate            マイグレーションを適用して終了する（リリース時に別ジョブで1回だけ実行 — #86）
#   job <name> [args]  dist/jobs/<name>.js を1回実行して終了する（例: job daily — #83）。
#                      残りの引数はジョブに渡す（例: job create-platform-admin --email ... --name ... — R-2-5）
#
# MIGRATE_ON_START=true のときだけ、API サーバーの起動前にマイグレーションを適用する。
# 複数レプリカ構成では、マイグレーションは別ジョブで 1 回だけ実行し、この変数は未設定にする。
set -eu

if [ "${1:-}" = "migrate" ]; then
  exec npx prisma migrate deploy
fi

if [ "${1:-}" = "job" ]; then
  name="${2:-}"
  case "$name" in
    ''|*[!a-z0-9-]*)
      echo "[entrypoint] usage: job <name>（英小文字・数字・ハイフンのみ）" >&2
      exit 64
      ;;
  esac
  if [ ! -f "dist/jobs/${name}.js" ]; then
    echo "[entrypoint] job not found: ${name}" >&2
    exit 64
  fi
  shift 2
  # ジョブの終了コードをそのまま返す（1 = いずれかのホテルで失敗。スケジューラ側で検知する）
  exec node "dist/jobs/${name}.js" "$@"
fi

if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] applying migrations (MIGRATE_ON_START=true)"
  npx prisma migrate deploy
fi

exec node dist/index.js
