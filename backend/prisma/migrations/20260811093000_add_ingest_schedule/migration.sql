-- CreateTable
CREATE TABLE "IngestSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "profileId" TEXT,
    "expectedAt" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "graceMinutes" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyTo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestSchedule_tenantId_idx" ON "IngestSchedule"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestSchedule_hotelId_source_key" ON "IngestSchedule"("hotelId", "source");

-- AddForeignKey
ALTER TABLE "IngestSchedule" ADD CONSTRAINT "IngestSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestSchedule" ADD CONSTRAINT "IngestSchedule_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

