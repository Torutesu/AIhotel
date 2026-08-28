-- データ保持期間のテナント別設定（D-06）とテナント別マスタ（D-10）

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "auditLogRetentionDays" INTEGER NOT NULL DEFAULT 730,
ADD COLUMN     "dailyDataRetentionDays" INTEGER,
ADD COLUMN     "operationalDataRetentionDays" INTEGER NOT NULL DEFAULT 365;

-- CreateTable
CREATE TABLE "OtaChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtaChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtaChannel_tenantId_idx" ON "OtaChannel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OtaChannel_tenantId_code_key" ON "OtaChannel"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ReviewSource_tenantId_idx" ON "ReviewSource"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSource_tenantId_code_key" ON "ReviewSource"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "OtaChannel" ADD CONSTRAINT "OtaChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSource" ADD CONSTRAINT "ReviewSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- テナント分離（D-01）。新規モデルには必ずRLSポリシーを付与する
ALTER TABLE "OtaChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtaChannel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OtaChannel"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "ReviewSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReviewSource"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');
