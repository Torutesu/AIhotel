-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "NewHotelOpening" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "sourceUrl" TEXT;

-- CreateTable
CREATE TABLE "MarketSignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "direction" TEXT NOT NULL,
    "magnitude" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "model" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "webSearches" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "eventsSaved" INTEGER NOT NULL DEFAULT 0,
    "openingsSaved" INTEGER NOT NULL DEFAULT 0,
    "signalsSaved" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "ExternalAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketSignal_tenantId_idx" ON "MarketSignal"("tenantId");

-- CreateIndex
CREATE INDEX "MarketSignal_hotelId_periodStart_idx" ON "MarketSignal"("hotelId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSignal_hotelId_kind_title_periodStart_key" ON "MarketSignal"("hotelId", "kind", "title", "periodStart");

-- CreateIndex
CREATE INDEX "ExternalAgentRun_tenantId_idx" ON "ExternalAgentRun"("tenantId");

-- CreateIndex
CREATE INDEX "ExternalAgentRun_hotelId_startedAt_idx" ON "ExternalAgentRun"("hotelId", "startedAt");

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAgentRun" ADD CONSTRAINT "ExternalAgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAgentRun" ADD CONSTRAINT "ExternalAgentRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
