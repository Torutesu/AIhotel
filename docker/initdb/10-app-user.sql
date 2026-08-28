-- 開発用DBにアプリケーションロールを作成する（SAAS_DECISIONS.md D-01）。
--
-- 本番では superuser でないロールで接続することでRLSが機能する。
-- 開発環境で superuser（postgres）のまま動かすと RLS が素通りし、
-- テナント分離のバグが本番まで気づかれない。開発でも本番と同じ条件にするため、
-- コンテナ初期化時に app_user を作成する。
--
-- 使い分け:
--   アプリ実行 (pnpm dev)            → app_user   … RLSが効く
--   マイグレーション・seed           → postgres   … DDLとデモデータ投入のため
--
-- 注意: このパスワードはローカル開発専用。本番は prisma/rls-role.sql を使い、
-- 生成したパスワードをシークレット管理に置くこと。

CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD 'app_password';

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
