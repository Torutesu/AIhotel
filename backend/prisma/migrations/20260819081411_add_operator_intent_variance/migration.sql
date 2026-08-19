-- CreateEnum
CREATE TYPE "PriceDecisionType" AS ENUM ('ACCEPTED', 'RAISED', 'LOWERED');

-- CreateEnum
CREATE TYPE "PriceIntentReason" AS ENUM ('FOLLOW_AI', 'COMPETITOR_MOVE', 'EVENT_DEMAND', 'GROUP_BLOCK', 'OTA_CAMPAIGN', 'BUDGET_PRESSURE', 'FIELD_INSIGHT', 'OPERATION_LIMIT', 'OTHER');

-- CreateTable
CREATE TABLE "PriceDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "date" DATE NOT NULL,
    "aiRecommendedRank" INTEGER,
    "aiRecommendedPrice" INTEGER,
    "aiPredictedOccupancy" DOUBLE PRECISION,
    "aiPredictedAdr" DOUBLE PRECISION,
    "aiDemandLevel" "DemandLevel",
    "aiConfidence" DOUBLE PRECISION,
    "aiModelVersion" TEXT,
    "appliedRank" INTEGER,
    "appliedPrice" INTEGER,
    "decisionType" "PriceDecisionType" NOT NULL,
    "intentReason" "PriceIntentReason" NOT NULL,
    "intentNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorPreferenceProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "demandLevel" "DemandLevel",
    "dayType" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "avgRankDelta" DOUBLE PRECISION NOT NULL,
    "medianRankDelta" DOUBLE PRECISION NOT NULL,
    "appliedRankDelta" INTEGER NOT NULL,
    "outperformRate" DOUBLE PRECISION,
    "evaluatedCount" INTEGER NOT NULL DEFAULT 0,
    "dominantIntentReason" "PriceIntentReason",
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledByUserId" TEXT,
    "modelVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorPreferenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceDecision_tenantId_idx" ON "PriceDecision"("tenantId");

-- CreateIndex
CREATE INDEX "PriceDecision_hotelId_date_idx" ON "PriceDecision"("hotelId", "date");

-- CreateIndex
CREATE INDEX "PriceDecision_hotelId_intentReason_idx" ON "PriceDecision"("hotelId", "intentReason");

-- CreateIndex
CREATE INDEX "OperatorPreferenceProfile_tenantId_idx" ON "OperatorPreferenceProfile"("tenantId");

-- CreateIndex
CREATE INDEX "OperatorPreferenceProfile_hotelId_isEnabled_idx" ON "OperatorPreferenceProfile"("hotelId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorPreferenceProfile_hotelId_segmentKey_key" ON "OperatorPreferenceProfile"("hotelId", "segmentKey");

-- AddForeignKey
ALTER TABLE "PriceDecision" ADD CONSTRAINT "PriceDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceDecision" ADD CONSTRAINT "PriceDecision_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceDecision" ADD CONSTRAINT "PriceDecision_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceDecision" ADD CONSTRAINT "PriceDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorPreferenceProfile" ADD CONSTRAINT "OperatorPreferenceProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorPreferenceProfile" ADD CONSTRAINT "OperatorPreferenceProfile_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
