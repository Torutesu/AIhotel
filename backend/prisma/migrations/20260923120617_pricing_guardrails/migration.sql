-- AlterTable
ALTER TABLE "AiPriceRecommendation" ADD COLUMN     "rationale" JSONB;

-- AlterTable
ALTER TABLE "PricingStrategyConfig" ADD COLUMN     "competitorOccupancy" INTEGER,
ADD COLUMN     "competitorOffsetPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hysteresisRanks" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "maxDailyRankChange" INTEGER DEFAULT 3,
ADD COLUMN     "maxRank" INTEGER,
ADD COLUMN     "minRank" INTEGER,
ALTER COLUMN "weightOccupancy" SET DEFAULT 100,
ALTER COLUMN "weightAdr" SET DEFAULT 0,
ALTER COLUMN "weightCompetitor" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "PricingLockPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingLockPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingLockPeriod_tenantId_idx" ON "PricingLockPeriod"("tenantId");

-- CreateIndex
CREATE INDEX "PricingLockPeriod_hotelId_startDate_idx" ON "PricingLockPeriod"("hotelId", "startDate");

-- AddForeignKey
ALTER TABLE "PricingLockPeriod" ADD CONSTRAINT "PricingLockPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingLockPeriod" ADD CONSTRAINT "PricingLockPeriod_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
