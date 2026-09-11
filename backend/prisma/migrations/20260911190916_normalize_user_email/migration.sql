-- User.email を小文字へ正規化する（#44）。
--
-- loginService / registerService は `findUnique({ where: { email } })` で検索するが、
-- PostgreSQL の text 比較は大文字小文字を区別するため `Admin@example.com` では
-- ログインできず、`User@x` と `user@x` が別ユーザーとして登録できてしまっていた。
-- zod スキーマ（loginSchema / registerSchema）で小文字へ正規化したので、
-- 既存行も同じ表現に揃える。
--
-- 正規化すると衝突する行（例: `User@x` と `user@x` が両方存在する）がある場合は、
-- どちらを残すかを機械的に決められない。黙ってどちらかを消すとログインできない
-- ユーザーが出るため、移行を中断して運用側で手動統合してもらう。

DO $$
DECLARE
  duplicated TEXT;
BEGIN
  SELECT string_agg(normalized, ', ')
    INTO duplicated
    FROM (
      SELECT lower("email") AS normalized
        FROM "User"
       GROUP BY lower("email")
      HAVING count(*) > 1
    ) AS collisions;

  IF duplicated IS NOT NULL THEN
    RAISE EXCEPTION
      'メールアドレスを小文字へ正規化すると重複するユーザーが存在します: %. 対象ユーザーを手動で統合してから再実行してください。',
      duplicated;
  END IF;
END $$;

UPDATE "User"
   SET "email" = lower("email"),
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "email" <> lower("email");
