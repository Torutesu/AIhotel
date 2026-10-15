-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "excludeFromHistory" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PriceBoundPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "weekdays" INTEGER[],
    "minRank" INTEGER,
    "maxRank" INTEGER,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBoundPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceBoundPeriod_tenantId_idx" ON "PriceBoundPeriod"("tenantId");

-- CreateIndex
CREATE INDEX "PriceBoundPeriod_hotelId_startDate_idx" ON "PriceBoundPeriod"("hotelId", "startDate");

-- AddForeignKey
ALTER TABLE "PriceBoundPeriod" ADD CONSTRAINT "PriceBoundPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBoundPeriod" ADD CONSTRAINT "PriceBoundPeriod_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
