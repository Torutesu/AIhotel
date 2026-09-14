-- CreateTable
CREATE TABLE "ImportMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "encoding" TEXT NOT NULL DEFAULT 'cp932',
    "delimiter" TEXT NOT NULL DEFAULT ',',
    "mapping" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "fileBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "dailyRows" INTEGER NOT NULL DEFAULT 0,
    "roomTypeRows" INTEGER NOT NULL DEFAULT 0,
    "channelRows" INTEGER NOT NULL DEFAULT 0,
    "curveRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "cancelledRows" INTEGER NOT NULL DEFAULT 0,
    "stayDateFrom" DATE,
    "stayDateTo" DATE,
    "errorMessage" TEXT,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportMapping_tenantId_idx" ON "ImportMapping"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMapping_hotelId_source_key" ON "ImportMapping"("hotelId", "source");

-- CreateIndex
CREATE INDEX "ImportRun_tenantId_idx" ON "ImportRun"("tenantId");

-- CreateIndex
CREATE INDEX "ImportRun_hotelId_source_startedAt_idx" ON "ImportRun"("hotelId", "source", "startedAt");

-- AddForeignKey
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
