-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 3;

-- CreateIndex
CREATE INDEX "Alert_hotelId_level_status_idx" ON "Alert"("hotelId", "level", "status");
