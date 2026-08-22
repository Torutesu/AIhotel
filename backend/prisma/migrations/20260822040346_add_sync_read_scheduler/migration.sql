-- AlterTable
ALTER TABLE "HotelSyncState" ADD COLUMN     "autoReadEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "readIntervalMinutes" INTEGER NOT NULL DEFAULT 360;
