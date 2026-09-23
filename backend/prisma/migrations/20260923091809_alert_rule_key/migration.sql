-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "ruleKey" TEXT;

-- CreateIndex
CREATE INDEX "Alert_hotelId_ruleKey_idx" ON "Alert"("hotelId", "ruleKey");
