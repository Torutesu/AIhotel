-- CreateEnum
CREATE TYPE "IngestConnectorKind" AS ENUM ('LOCAL_DIR', 'HTTPS');

-- AlterTable
ALTER TABLE "IngestLog" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "origin" TEXT;

-- AlterTable
ALTER TABLE "IngestSchedule" ADD COLUMN     "connector" "IngestConnectorKind",
ADD COLUMN     "connectorConfig" JSONB,
ADD COLUMN     "lastRunAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "IngestLog_hotelId_source_checksum_idx" ON "IngestLog"("hotelId", "source", "checksum");

