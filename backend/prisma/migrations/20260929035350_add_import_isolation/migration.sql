-- AlterTable
ALTER TABLE "ImportMapping" ADD COLUMN     "facilityColumn" TEXT,
ADD COLUMN     "facilityValues" JSONB,
ADD COLUMN     "targets" JSONB NOT NULL DEFAULT '[]';
