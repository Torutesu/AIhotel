-- CreateEnum
CREATE TYPE "HotelType" AS ENUM ('FULL_SERVICE', 'LIMITED_SERVICE', 'RESORT', 'RYOKAN');

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "hotelType" "HotelType",
ADD COLUMN     "marketArea" TEXT,
ADD COLUMN     "municipalityCode" TEXT,
ADD COLUMN     "prefectureCode" TEXT;
