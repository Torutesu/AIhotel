-- AlterTable
ALTER TABLE "PricingStrategyConfig" ADD COLUMN     "dayModelAdjust" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "priceElasticity" DOUBLE PRECISION NOT NULL DEFAULT 1;

