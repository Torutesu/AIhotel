-- AlterTable
ALTER TABLE "AiPriceRecommendation" ADD COLUMN     "predictedOccupancyP10" DOUBLE PRECISION,
ADD COLUMN     "predictedOccupancyP90" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "forecastDate" DATE NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "predictedOccupancy" DOUBLE PRECISION,
    "predictedOccupancyP10" DOUBLE PRECISION,
    "predictedOccupancyP90" DOUBLE PRECISION,
    "demandLevel" "DemandLevel",
    "recommendedRank" INTEGER,
    "recommendedPrice" INTEGER,
    "confidence" DOUBLE PRECISION,
    "modelVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastSnapshot_tenantId_idx" ON "ForecastSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_hotelId_stayDate_idx" ON "ForecastSnapshot"("hotelId", "stayDate");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_hotelId_forecastDate_idx" ON "ForecastSnapshot"("hotelId", "forecastDate");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_hotelId_stayDate_forecastDate_modelVersion_key" ON "ForecastSnapshot"("hotelId", "stayDate", "forecastDate", "modelVersion");

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
