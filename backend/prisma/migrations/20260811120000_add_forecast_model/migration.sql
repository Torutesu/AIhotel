-- CreateTable
CREATE TABLE "ForecastModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "validationMae" DOUBLE PRECISION NOT NULL,
    "featureNames" JSONB NOT NULL,
    "featureImportance" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "candidates" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastModel_tenantId_idx" ON "ForecastModel"("tenantId");

-- CreateIndex
CREATE INDEX "ForecastModel_hotelId_isActive_idx" ON "ForecastModel"("hotelId", "isActive");

-- AddForeignKey
ALTER TABLE "ForecastModel" ADD CONSTRAINT "ForecastModel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastModel" ADD CONSTRAINT "ForecastModel_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

