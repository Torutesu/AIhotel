-- CreateEnum
CREATE TYPE "TrialKind" AS ENUM ('DEALER', 'PROSPECT_HOTEL');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "trialExpiresAt" TIMESTAMP(3),
ADD COLUMN     "trialKind" "TrialKind",
ADD COLUMN     "trialNote" TEXT;
