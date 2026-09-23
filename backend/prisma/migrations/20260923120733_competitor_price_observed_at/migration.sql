-- AlterTable
ALTER TABLE "CompetitorPriceData" ADD COLUMN     "observedAt" TIMESTAMP(3),
ADD COLUMN     "soldOut" BOOLEAN NOT NULL DEFAULT false;
