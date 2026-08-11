-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "predictedAt" DATE NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "predictedOccupancy" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "actualOccupancy" DOUBLE PRECISION,
    "absError" DOUBLE PRECISION,
    "scoredAt" TIMESTAMP(3),
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastSnapshot_tenantId_idx" ON "ForecastSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_hotelId_stayDate_idx" ON "ForecastSnapshot"("hotelId", "stayDate");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_hotelId_predictedAt_idx" ON "ForecastSnapshot"("hotelId", "predictedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_hotelId_stayDate_predictedAt_modelVersion_key" ON "ForecastSnapshot"("hotelId", "stayDate", "predictedAt", "modelVersion");

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

