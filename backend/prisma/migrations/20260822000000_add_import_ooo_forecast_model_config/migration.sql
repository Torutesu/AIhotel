-- CreateTable
CREATE TABLE "OutOfOrderRoom" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "rooms" INTEGER NOT NULL,
    "reason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutOfOrderRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastModelConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 0,
    "movingAverageWindowDays" INTEGER NOT NULL DEFAULT 28,
    "movingAverageWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "eventImpactHighPt" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "eventImpactMediumPt" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "eventImpactLowPt" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "weekendAdjustmentPt" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "fallbackOccupancy" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "notes" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutOfOrderRoom_tenantId_idx" ON "OutOfOrderRoom"("tenantId");

-- CreateIndex
CREATE INDEX "OutOfOrderRoom_hotelId_startDate_endDate_idx" ON "OutOfOrderRoom"("hotelId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ForecastModelConfig_tenantId_idx" ON "ForecastModelConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastModelConfig_hotelId_year_key" ON "ForecastModelConfig"("hotelId", "year");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_idx" ON "ImportJob"("tenantId");

-- CreateIndex
CREATE INDEX "ImportJob_hotelId_createdAt_idx" ON "ImportJob"("hotelId", "createdAt");

-- AddForeignKey
ALTER TABLE "OutOfOrderRoom" ADD CONSTRAINT "OutOfOrderRoom_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutOfOrderRoom" ADD CONSTRAINT "OutOfOrderRoom_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutOfOrderRoom" ADD CONSTRAINT "OutOfOrderRoom_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastModelConfig" ADD CONSTRAINT "ForecastModelConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastModelConfig" ADD CONSTRAINT "ForecastModelConfig_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

