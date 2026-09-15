# 常設デプロイ手順（バックエンド + PostgreSQL + Vercel 接続 + 日次ジョブ）

2026-09-15 時点の確認結果: Vercel の画面は 2 プロジェクトとも公開済みだが、両サイトの `/api/health` は
502「バックエンドに接続できません」（`frontend/app/api/[...path]/route.ts` が返す応答）。バックエンドは
`docker/backend.Dockerfile` とマイグレーションまで揃っているが**常設先が無く、DB も無い**。GitHub Actions は
テスト・ビルドのみで配備処理が無く、日次ジョブ（`backend/src/jobs/daily.ts`）も登録されていない。

この文書は、その欠けている 4 つ（常設先・DB・Vercel の接続・日次実行）を埋める手順。コードの作り直しは
しない。バックエンドの API・変換処理・マイグレーションは現状のまま使う。

| 節 | やること | 誰が | 所要 |
|---|---|---|---|
| §1 | 常設先の決定（Fly.io を採用する理由と AWS/GCP との対応） | 判断のみ | — |
| §2 | 前提（CLI・アカウント） | オーナー | 10 分 |
| §3 | Fly にアプリと PostgreSQL を作り、シークレットを入れ、初回デプロイ、最初の運営アカウント | オーナー | 30 分 |
| §4 | GitHub に `FLY_API_TOKEN` を登録（以後は push で自動デプロイ） | オーナー | 5 分 |
| §5 | Vercel の 2 プロジェクトに `BACKEND_URL` を設定して再デプロイ | オーナー | 10 分 |
| §6 | ホテル側 Windows 送信スクリプトの送信先指定 | ホテル側担当 | — |
| §7 | 日次ジョブの有効化と確認 | オーナー | 5 分 |
| §8 | 取得→送信→取込の検証手順 | 双方 | — |
| §9 | 運用（ログ・ロールバック・バックアップ・費用） | — | — |

---

## §1 常設先の決定

### 採用: Fly.io（東京リージョン `nrt`）

| 観点 | Fly.io | AWS（ECS Fargate + RDS） | GCP（Cloud Run + Cloud SQL） |
|---|---|---|---|
| アプリ側の変更 | 不要（同じ Docker イメージ、`DATABASE_URL` だけ） | 不要 | 不要 |
| 必要な構築物 | app 1 つ + Postgres 1 つ（コマンド 2 本） | VPC / ALB / ECS クラスタ / タスク定義 / RDS / IAM / Secrets Manager | Cloud Run / Cloud SQL / VPC コネクタ / Secret Manager / Cloud Scheduler |
| 月額の目安（最小構成） | **約 $8〜15**（shared-cpu-1x 1GB + Postgres shared-cpu-1x 1GB / 10GB） | 約 $40〜70（Fargate 0.5vCPU + RDS db.t4g.micro + ALB） | 約 $20〜40（Cloud Run 常時 1 + Cloud SQL db-f1-micro） |
| 既存の運用 | オーナーが別プロダクトで運用中（同じ CLI・同じ課金先） | 未使用 | 未使用 |
| 日次ジョブ | GitHub Actions の cron から実行（§7） | EventBridge Scheduler | Cloud Scheduler |
| 撤退コスト | イメージはそのまま、`DATABASE_URL` を移すだけ | 同左 | 同左 |

決め手は 3 つ。(1) コードがクラウド非依存に作ってある（`AGENTS.md`・`要件定義書.md` §8.1）ので、選択はホスティング
費用と運用手間だけの問題になる。(2) オーナーは既に Fly.io を別プロダクトで運用しており、アカウント・支払い・
CLI・障害対応の勘所がそのまま使える。(3) 最小構成の費用が AWS/GCP の 1/3〜1/5 で、Cloud Scheduler や
EventBridge 相当の追加構築も要らない。

**費用とリソースの所有先が変わる判断なので、この節の採用はオーナーの了承が要る。** AWS/GCP を選ぶ場合も §2 以降の
「Vercel の `BACKEND_URL`」「ホテル側の送信先」「日次ジョブ」は同じ考え方で、`fly.toml` を各クラウドの定義に
置き換えるだけ（README「デプロイ」節の構成例）。

### 所有

- Fly.io アカウント: オーナー個人（支払い方法もそこ）。組織を分けたい場合は `fly orgs create` で組織を作り、以下の
  コマンドに `--org <name>` を付ける。
- GitHub: `Torutesu/AIhotel`（public。Actions の分数は無料枠内で、cron も課金されない）。
- Vercel: 既存の 2 プロジェクト（本番と、`hotel-price.vercel.app` のデモ）。

## §2 前提

```bash
brew install flyctl          # または https://fly.io/docs/flyctl/install/
fly auth login
fly auth whoami              # 支払い方法が登録された個人アカウントであること
```

リポジトリの `main` をチェックアウトしておく。`fly.toml` はリポジトリ直下にある（アプリ名 `aihotel-api`。
変える場合は `fly.toml` の `app` と §4 のトークン作成コマンドを合わせて変える）。

## §3 Fly にアプリと DB を作る（初回だけ）

### 3-1 アプリ

```bash
fly apps create aihotel-api --org personal
```

### 3-2 PostgreSQL 16

```bash
fly postgres create --name aihotel-db --region nrt \
  --vm-size shared-cpu-1x --volume-size 10 --initial-cluster-size 1
fly postgres attach aihotel-db --app aihotel-api
```

`attach` が `DATABASE_URL` を `aihotel-api` のシークレットとして設定する（`postgres://…@aihotel-db.flycast:5432/aihotel_api`。
Fly の private network 内なので TLS 不要、Prisma の既定 schema `public` で動く）。表示された接続文字列は
**このとき一度しか出ない**。控えるならパスワードマネージャへ。

> 単一ノードの Postgres は開発・初期運用向け。自動フェイルオーバーが必要になったら
> `fly postgres create --initial-cluster-size 3`（HA）か、Neon / Supabase 等の外部 Postgres へ `DATABASE_URL` を
> 差し替える。アプリ側の変更は無い。

### 3-3 シークレット

```bash
openssl rand -base64 64 | tr -d '\n' | fly secrets set JWT_SECRET=- --app aihotel-api --stage
fly secrets set --app aihotel-api --stage \
  FRONTEND_URL=https://<本番の Vercel ドメイン>,https://hotel-price.vercel.app
fly secrets deploy --app aihotel-api   # 初回はアプリがまだ無いので、次の 3-4 の deploy と一緒に適用される
```

- `JWT_SECRET` は 32 文字以上必須（未設定なら起動時に throw — `backend/src/lib/config.ts`）。上のように stdin 経由で
  渡し、シェル履歴に残さない。
- `FRONTEND_URL` は CORS の許可オリジン（カンマ区切り、末尾スラッシュなし）。ブラウザは Vercel 経由の
  same-origin `/api/*` を叩くので、実際に CORS が効くのは直叩きだけだが、値は正しく入れておく。
- `NODE_ENV` / `PORT` / `TRUST_PROXY` / `MIGRATE_ON_START` は `fly.toml` の `[env]` にある（秘密ではない）。

### 3-4 初回デプロイと最初の運営アカウント

```bash
fly deploy --config fly.toml --dockerfile docker/backend.Dockerfile --remote-only
curl -fsS https://aihotel-api.fly.dev/health
# → {"success":true,"data":{"api":"healthy","database":"healthy",...}}
```

`MIGRATE_ON_START=true` なので起動時に `prisma migrate deploy` が走り、テーブルができる。**seed は本番に
投入しない**（デモアカウントは既知のパスワードのため — `AGENTS.md`）。その代わり最初の運営（PLATFORM_ADMIN）を
1 回だけ作る:

```bash
fly ssh console --app aihotel-api -C \
  "env BOOTSTRAP_PLATFORM_ADMIN_EMAIL=<運営メール> BOOTSTRAP_PLATFORM_ADMIN_PASSWORD=<8文字以上・大小英字・数字> \
   node /app/backend/dist/jobs/bootstrapPlatformAdmin.js"
```

運営が既に 1 人でもいれば何もしない（冪等）。以後のユーザー・テナント・ホテルの作成は、この運営でログインして
通常の API / 画面から行う（`POST /api/v1/hotels`、`POST /api/v1/auth/register`）。

## §4 GitHub Actions からの自動デプロイ

```bash
fly tokens create deploy --app aihotel-api --expiry 8760h
```

出力されたトークンを GitHub の **Settings → Secrets and variables → Actions → New repository secret** に
`FLY_API_TOKEN` として登録する。以後:

- `main` への push で `backend/` `shared/` `docker/backend.*` `fly.toml` 等が変わると
  `.github/workflows/deploy-backend.yml` がイメージをビルドしてデプロイし、最後に `/health` を確認する。
- 手動で再デプロイしたいときは Actions タブ → **Deploy backend (Fly)** → Run workflow。
- トークン未登録の間は「ビルドのみ・deploy skipped」で緑になる（赤にはならない）。

アプリのシークレットは GitHub には置かない。置くのはデプロイ権限だけのトークン 1 つ。

## §5 Vercel の画面をバックエンドへ接続する

2 プロジェクトそれぞれで:

1. **Settings → Environment Variables** に `BACKEND_URL` = `https://aihotel-api.fly.dev`（末尾スラッシュなし）を
   Production と Preview に追加する。ブラウザには露出しない（サーバー側の中継 `app/api/[...path]/route.ts` だけが読む）。
2. `NEXT_PUBLIC_DEMO_MODE` は**本番プロジェクトでは未設定**にする。デモ用プロジェクトだけ `true`。
3. **Deployments → 最新 → Redeploy**（環境変数の変更は再デプロイで反映される）。
4. 確認:

```bash
curl -fsS https://<Vercel ドメイン>/api/health
# 502 ではなく {"success":true,"data":{"api":"healthy","database":"healthy",...}} が返る
```

ブラウザで運営アカウントでログインし、テナント・ホテルを作る。

## §6 ホテル側 Windows 送信スクリプトの送信先

送信先はバックエンド直（Vercel を経由しない）:

| 項目 | 値 |
|---|---|
| ベース URL | `https://aihotel-api.fly.dev/api/v1` |
| 認証 | `POST /auth/login` で得た `accessToken` を `Authorization: Bearer <token>` に付ける。失効時は `POST /auth/refresh` |
| ホテル側のユーザー | 運営が当該テナントに OPERATOR（または MANAGER）を作って渡す。運営アカウントを配らない |
| レート制限 | 認証済みはユーザー単位 1000 req / 15 分（`RATE_LIMIT_MAX_REQUESTS`）。日次バッチ送信には十分 |

**現時点の `main` には CSV / Excel を受け取る取込エンドポイントが無い。** 取込 API は未マージの PR にある
（#38 Excel import、#39 SaaS onboarding + CSV import、#25 PMS data ingestion）。送信スクリプトが送る形式と
どの PR を採用するかを先に決め、それをマージしてから送信先エンドポイントを確定する。この文書はそこを
決めない。決まるまで、ホテル側はログインと `GET /api/v1/hotels` の疎通だけ先に確認できる。

## §7 日次ジョブ

`.github/workflows/daily-job.yml` が毎日 03:00 JST に、稼働中の Fly マシンの中で
`node /app/backend/dist/jobs/daily.js` を実行する（需要予測の再計算 → 着地シミュレーション → KPI スナップショット →
期限切れリフレッシュトークン掃除。冪等）。§4 の `FLY_API_TOKEN` があれば追加設定は無い。

- 初回は Actions タブ → **Daily batch (03:00 JST)** → Run workflow で手動実行し、ログに
  「日次バッチが完了しました（成功 N / 失敗 0）」が出ることを確認する。
- 1 ホテルでも失敗すると終了コード 1 でジョブが赤になる。失敗ホテルの一覧はログの `failures` に出る。
- スケジュールを変えるときは cron（UTC）を編集する。

> なぜ Fly の scheduled machine ではなく Actions か: 常に「いまデプロイされているイメージ」で実行され、二重管理が
> 無い。public リポジトリなので cron は無料。失敗が赤い実行として残る。

## §8 取得 → 送信 → 取込 の検証

| 段階 | 確認方法 | 期待 |
|---|---|---|
| バックエンド稼働 | `curl https://aihotel-api.fly.dev/health` | `database: healthy` |
| Vercel 接続 | `curl https://<Vercel>/api/health` | 同上（502 でない） |
| 認証 | 送信スクリプトの資格情報で `POST /auth/login` | `accessToken` が返る |
| 送信 | 取込 API（§6 の決定後）へ 1 日分を送る | `{"success":true}` |
| 取込履歴 | `AuditLog`（`fly ssh console` → `psql` か Prisma Studio）または画面 | 送信した日付の行がある |
| 日次ジョブ | §7 の手動実行 | `KpiSnapshot` に当日の行が増える |
| 欠損 | 日次ジョブの `failures` と、送信スクリプト側の送信ログを突き合わせる | 送信されなかった日が特定できる |

`main` には「欠損検知」という独立した処理は無い（日次ジョブが失敗を数えるだけ）。日付の抜けを自動で検知して
通知するには、取込 API の採用（§6）と同時に `DailyData` の日付連続性を確認するジョブを足す。

## §9 運用

```bash
fly logs --app aihotel-api                 # ログ（pino JSON）
fly status --app aihotel-api               # マシン状態
fly releases --app aihotel-api             # デプロイ履歴
fly deploy --app aihotel-api --image <前のイメージ>   # ロールバック（releases の image を指定）
fly postgres connect --app aihotel-db      # psql
fly ssh console --app aihotel-api -C "node /app/backend/dist/jobs/daily.js"   # 日次ジョブを手で回す
```

- **バックアップ**: Fly Postgres は日次スナップショット（`fly volumes snapshots list`）。加えて週 1 の
  `pg_dump` をローカルに落とす運用を推奨（`fly postgres connect` 経由）。
- **スケール**: マシンを 2 台以上にする前に `fly.toml` の `MIGRATE_ON_START` を外し、マイグレーションを
  デプロイ前の別ステップにする（`docker/backend.Dockerfile` 冒頭のコメント）。
- **費用**: shared-cpu-1x 1GB 常時 1 台 ≒ $5〜7/月、Postgres shared-cpu-1x 1GB + 10GB ≒ $3〜5/月。
  Fly の請求は従量なので、`fly dashboard` の Billing で月初に確認する。
- **ドメイン**: 独自ドメインにする場合は `fly certs create api.<domain>` → DNS に CNAME → Vercel の `BACKEND_URL`
  と §6 のベース URL を差し替える。
