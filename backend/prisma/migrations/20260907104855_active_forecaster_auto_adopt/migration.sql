-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "activeForecaster" TEXT NOT NULL DEFAULT 'rule-based-v2';

-- AlterTable
ALTER TABLE "PricingStrategyConfig" ADD COLUMN     "autoAdopt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoAdoptMaxLeadDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "autoAdoptMinConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8;
