-- AlterTable
ALTER TABLE "AiPriceRecommendation" ADD COLUMN     "contributions" JSONB,
ADD COLUMN     "expectedRevParCurrent" DOUBLE PRECISION,
ADD COLUMN     "expectedRevParRecommended" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "jmaAreaCode" TEXT,
ADD COLUMN     "jmaOfficeCode" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "PricingStrategyConfig" ADD COLUMN     "competitorPositionPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maxDailyRankChange" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "maxRank" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "minRank" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ExternalSignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "signalType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),

    CONSTRAINT "ExternalSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "asOfDate" DATE NOT NULL,
    "leadDays" INTEGER NOT NULL,
    "predictedOccupancy" DOUBLE PRECISION NOT NULL,
    "recommendedRank" INTEGER NOT NULL,
    "currentRank" INTEGER,
    "demandFactors" JSONB NOT NULL,
    "contributions" JSONB NOT NULL,
    "expectedRevParCurrent" DOUBLE PRECISION,
    "expectedRevParRecommended" DOUBLE PRECISION,
    "confidence" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "recommendedRank" INTEGER NOT NULL,
    "appliedRank" INTEGER NOT NULL,
    "decidedByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactorCoefficient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "factorKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactorCoefficient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalSignal_tenantId_idx" ON "ExternalSignal"("tenantId");

-- CreateIndex
CREATE INDEX "ExternalSignal_hotelId_date_idx" ON "ExternalSignal"("hotelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSignal_hotelId_date_signalType_source_key" ON "ExternalSignal"("hotelId", "date", "signalType", "source");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_tenantId_idx" ON "ForecastSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_hotelId_stayDate_idx" ON "ForecastSnapshot"("hotelId", "stayDate");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_hotelId_asOfDate_idx" ON "ForecastSnapshot"("hotelId", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_hotelId_stayDate_asOfDate_key" ON "ForecastSnapshot"("hotelId", "stayDate", "asOfDate");

-- CreateIndex
CREATE INDEX "RecommendationDecision_tenantId_idx" ON "RecommendationDecision"("tenantId");

-- CreateIndex
CREATE INDEX "RecommendationDecision_hotelId_stayDate_createdAt_idx" ON "RecommendationDecision"("hotelId", "stayDate", "createdAt");

-- CreateIndex
CREATE INDEX "FactorCoefficient_tenantId_idx" ON "FactorCoefficient"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FactorCoefficient_hotelId_factorKey_key" ON "FactorCoefficient"("hotelId", "factorKey");

-- AddForeignKey
ALTER TABLE "ExternalSignal" ADD CONSTRAINT "ExternalSignal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSignal" ADD CONSTRAINT "ExternalSignal_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationDecision" ADD CONSTRAINT "RecommendationDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationDecision" ADD CONSTRAINT "RecommendationDecision_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactorCoefficient" ADD CONSTRAINT "FactorCoefficient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactorCoefficient" ADD CONSTRAINT "FactorCoefficient_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
