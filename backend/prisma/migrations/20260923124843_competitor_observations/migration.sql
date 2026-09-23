-- CreateTable
CREATE TABLE "CompetitorRateObservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "price1P" INTEGER,
    "price2P" INTEGER,
    "price3P" INTEGER,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorRateObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorFetchRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "observations" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "CompetitorFetchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitorRateObservation_tenantId_idx" ON "CompetitorRateObservation"("tenantId");

-- CreateIndex
CREATE INDEX "CompetitorRateObservation_competitorId_stayDate_source_obse_idx" ON "CompetitorRateObservation"("competitorId", "stayDate", "source", "observedAt");

-- CreateIndex
CREATE INDEX "CompetitorFetchRun_tenantId_idx" ON "CompetitorFetchRun"("tenantId");

-- CreateIndex
CREATE INDEX "CompetitorFetchRun_hotelId_source_startedAt_idx" ON "CompetitorFetchRun"("hotelId", "source", "startedAt");

-- AddForeignKey
ALTER TABLE "CompetitorRateObservation" ADD CONSTRAINT "CompetitorRateObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorRateObservation" ADD CONSTRAINT "CompetitorRateObservation_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorRateObservation" ADD CONSTRAINT "CompetitorRateObservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CompetitorFetchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorFetchRun" ADD CONSTRAINT "CompetitorFetchRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
