-- 料金ランクの再設計（F-SET-02 — docs/drive-gap-analysis.md §2.1）と
-- 特日マスタ・外部要因の追加（F-DP-08 / F-EXT-01）、価格戦略の重み付け設定の撤去（§3-3）。
--
-- PriceRank は「hotelId + rank番号（1〜40）」から
-- 「hotelId + roomTypeId + rateCategory + rankCode（65〜0＋★1〜★5）」へ構造が変わる。
-- 旧構造の行は新しい必須列（roomTypeId/rateCategory/rankCode/sortOrder/price）を
-- 埋められないため、変換ではなく削除して seed から販売料金表を投入し直す。
-- 対象は開発・デモ環境のシードデータのみ（本番データは未投入）。
DELETE FROM "PriceRank";

-- CreateEnum
CREATE TYPE "RateCategory" AS ENUM ('OWN', 'MEMBER', 'SHAREHOLDER', 'OTA');

-- CreateEnum
CREATE TYPE "SpecialDayKind" AS ENUM ('HOLIDAY', 'TOKUJITSU');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "FactorCategory" AS ENUM ('WEATHER', 'INBOUND', 'EVENT', 'ACCESS', 'NEW_HOTEL', 'ECONOMY', 'OTHER');

-- CreateEnum
CREATE TYPE "FactorTimeAxis" AS ENUM ('TOKUJITSU', 'PERIOD', 'DAILY');

-- DropForeignKey
ALTER TABLE "PricingStrategyConfig" DROP CONSTRAINT "PricingStrategyConfig_hotelId_fkey";

-- DropForeignKey
ALTER TABLE "PricingStrategyConfig" DROP CONSTRAINT "PricingStrategyConfig_tenantId_fkey";

-- DropIndex
DROP INDEX "PriceRank_hotelId_idx";

-- DropIndex
DROP INDEX "PriceRank_hotelId_rank_key";

-- AlterTable
ALTER TABLE "AiPriceRecommendation" ADD COLUMN     "recommendedRankCode" TEXT;

-- AlterTable
ALTER TABLE "DailyRoomData" DROP COLUMN "priceRank",
ADD COLUMN     "priceRankCode" TEXT;

-- AlterTable
ALTER TABLE "PriceRank" DROP COLUMN "label",
DROP COLUMN "price1P",
DROP COLUMN "price2P",
DROP COLUMN "price3P",
DROP COLUMN "price4P",
DROP COLUMN "rank",
ADD COLUMN     "price" INTEGER NOT NULL,
ADD COLUMN     "rankCode" TEXT NOT NULL,
ADD COLUMN     "rateCategory" "RateCategory" NOT NULL,
ADD COLUMN     "roomTypeId" TEXT NOT NULL,
ADD COLUMN     "sortOrder" INTEGER NOT NULL;

-- DropTable
DROP TABLE "PricingStrategyConfig";

-- CreateTable
CREATE TABLE "SpecialDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SpecialDayKind" NOT NULL,
    "color" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalFactor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "category" "FactorCategory" NOT NULL,
    "timeAxis" "FactorTimeAxis" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "impactScore" DOUBLE PRECISION,
    "area" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalFactor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialDay_tenantId_idx" ON "SpecialDay"("tenantId");

-- CreateIndex
CREATE INDEX "SpecialDay_hotelId_date_idx" ON "SpecialDay"("hotelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialDay_hotelId_date_name_key" ON "SpecialDay"("hotelId", "date", "name");

-- CreateIndex
CREATE INDEX "ExternalFactor_tenantId_idx" ON "ExternalFactor"("tenantId");

-- CreateIndex
CREATE INDEX "ExternalFactor_hotelId_startDate_endDate_idx" ON "ExternalFactor"("hotelId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "PriceRank_hotelId_roomTypeId_rateCategory_idx" ON "PriceRank"("hotelId", "roomTypeId", "rateCategory");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRank_hotelId_roomTypeId_rateCategory_rankCode_key" ON "PriceRank"("hotelId", "roomTypeId", "rateCategory", "rankCode");

-- AddForeignKey
ALTER TABLE "PriceRank" ADD CONSTRAINT "PriceRank_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialDay" ADD CONSTRAINT "SpecialDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialDay" ADD CONSTRAINT "SpecialDay_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFactor" ADD CONSTRAINT "ExternalFactor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFactor" ADD CONSTRAINT "ExternalFactor_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

