-- アプリケーション用DBロールの作成（SAAS_DECISIONS.md D-01）
--
-- 【なぜ必要か】
-- PostgreSQL の superuser と BYPASSRLS 属性を持つロールは Row Level Security を
-- 完全に素通りする。Cloud SQL の既定ユーザー（postgres）でアプリを接続すると
-- ポリシーを書いても一切効かず、テナント分離が無効になる。
-- アプリは必ずこのロールで接続すること。
--
-- 【使い方】
--   1. マイグレーション適用後、superuser でこのファイルを実行する
--   2. アプリの DATABASE_URL を app_user 側の接続文字列に切り替える
--   3. マイグレーション実行用の接続（prisma migrate deploy）は従来の管理ロールのまま
--
-- パスワードはこのファイルに書かず、実行時に置換すること:
--   psql "$ADMIN_DATABASE_URL" -v app_password="'<生成したパスワード>'" -f prisma/rls-role.sql

\set ON_ERROR_STOP on

-- NOSUPERUSER / NOBYPASSRLS を明示する（既定値だが、意図を残すため）。
-- psql は $$ で囲まれた文字列の中では変数を展開しないため、
-- format() で組み立てた SQL を \gexec で実行する（パスワードは %L で安全にクォートされる）。
SELECT format(
  'CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
\gexec

SELECT format(
  'ALTER ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L',
  :'app_password'
)
\gexec

-- スキーマとテーブルへの権限（DDLは与えない。マイグレーションは管理ロールで行う）
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 今後追加されるテーブルにも自動で権限を付与する
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- マイグレーション履歴テーブルはアプリから触らせない
REVOKE ALL ON TABLE "_prisma_migrations" FROM app_user;

-- 確認: 両方とも false であること
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';
