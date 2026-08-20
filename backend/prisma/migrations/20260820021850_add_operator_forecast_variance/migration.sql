-- CreateEnum
CREATE TYPE "ForecastVarianceReason" AS ENUM ('BOOKING_PACE', 'COMPETITOR_SUPPLY', 'EVENT_LOCAL', 'GROUP_CONTRACT', 'REPEAT_GUEST', 'MARKET_TREND', 'OTA_CAMPAIGN', 'RENOVATION_OPS', 'DATA_DOUBT', 'OTHER');

-- CreateTable
CREATE TABLE "OperatorForecast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "forecastOccupancy" DOUBLE PRECISION,
    "forecastAdr" DOUBLE PRECISION,
    "forecastSoldRooms" INTEGER,
    "forecastRevenue" DOUBLE PRECISION,
    "aiOccupancy" DOUBLE PRECISION,
    "aiAdr" DOUBLE PRECISION,
    "aiSoldRooms" INTEGER,
    "aiRevenue" DOUBLE PRECISION,
    "aiDemandLevel" "DemandLevel",
    "aiConfidence" DOUBLE PRECISION,
    "aiModelVersion" TEXT,
    "exceededThreshold" BOOLEAN NOT NULL DEFAULT false,
    "varianceReason" "ForecastVarianceReason",
    "varianceNote" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastVarianceSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "occupancyPtThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "adrPctThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "revenuePctThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastVarianceSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperatorForecast_tenantId_idx" ON "OperatorForecast"("tenantId");

-- CreateIndex
CREATE INDEX "OperatorForecast_hotelId_date_idx" ON "OperatorForecast"("hotelId", "date");

-- CreateIndex
CREATE INDEX "OperatorForecast_hotelId_varianceReason_idx" ON "OperatorForecast"("hotelId", "varianceReason");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorForecast_hotelId_date_version_key" ON "OperatorForecast"("hotelId", "date", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastVarianceSetting_hotelId_key" ON "ForecastVarianceSetting"("hotelId");

-- CreateIndex
CREATE INDEX "ForecastVarianceSetting_tenantId_idx" ON "ForecastVarianceSetting"("tenantId");

-- AddForeignKey
ALTER TABLE "OperatorForecast" ADD CONSTRAINT "OperatorForecast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorForecast" ADD CONSTRAINT "OperatorForecast_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorForecast" ADD CONSTRAINT "OperatorForecast_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastVarianceSetting" ADD CONSTRAINT "ForecastVarianceSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastVarianceSetting" ADD CONSTRAINT "ForecastVarianceSetting_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
