-- メールアドレスをテナント単位で一意にする（SAAS_DECISIONS.md D-02）
--
-- 同一人物がグループ会社・運営受託先など複数テナントに所属できるようにするため、
-- システム全体での一意をやめる。

-- DropIndex
DROP INDEX "User_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- 提供側ADMIN（tenantId IS NULL）の重複防止。
-- PostgreSQL は NULL 同士を「異なる値」として扱うため、上の複合一意だけでは
-- tenantId が NULL のユーザーは同じメールで何件でも作れてしまう。
-- Prisma スキーマでは部分インデックスを表現できないため、ここで直接定義する。
CREATE UNIQUE INDEX "User_email_key_when_no_tenant"
  ON "User"("email") WHERE "tenantId" IS NULL;
