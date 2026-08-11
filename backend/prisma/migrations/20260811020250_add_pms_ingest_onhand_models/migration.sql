-- CreateEnum
CREATE TYPE "SegmentKind" AS ENUM ('SOURCE', 'CHANNEL', 'MARKET', 'REGION', 'AGENT', 'RATE_TYPE', 'ROOM_GROUP', 'CHANNEL_GROUP', 'REGION_GROUP');

-- CreateEnum
CREATE TYPE "IngestStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "SegmentMaster" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "SegmentKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aggregateCode" TEXT,
    "attributes" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SegmentMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "capturedDate" DATE NOT NULL,
    "bookedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "roomTypeCode" TEXT NOT NULL,
    "rateTypeCode" TEXT,
    "packageCode" TEXT,
    "rooms" INTEGER NOT NULL,
    "guests" INTEGER,
    "roomRevenue" DOUBLE PRECISION,
    "serviceFee" DOUBLE PRECISION,
    "agentCode" TEXT,
    "regionCode" TEXT,
    "marketCode" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "ingestLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationNight" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "roomTypeCode" TEXT NOT NULL,
    "rateTypeCode" TEXT,
    "packageCode" TEXT,
    "rooms" INTEGER NOT NULL,
    "guests" INTEGER,
    "guestsDetail" JSONB,
    "roomRevenue" DOUBLE PRECISION,
    "serviceFee" DOUBLE PRECISION,
    "agentCode" TEXT,
    "regionCode" TEXT,
    "marketCode" TEXT,
    "individualGroupType" TEXT,
    "buildingCode" TEXT,
    "blockCode" TEXT,
    "checkIn" DATE,
    "checkOut" DATE,
    "isDayUse" BOOLEAN NOT NULL DEFAULT false,
    "compHuType" TEXT,
    "ingestLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationNight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnHandSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "capturedDate" DATE NOT NULL,
    "rooms" INTEGER NOT NULL,
    "revenue" DOUBLE PRECISION,
    "guests" INTEGER,
    "segments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnHandSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomInventorySnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomTypeCode" TEXT NOT NULL,
    "stayDate" DATE NOT NULL,
    "capturedDate" DATE NOT NULL,
    "remainingRooms" INTEGER NOT NULL,
    "totalRooms" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomInventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "IngestStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "targetDate" DATE,
    "rowCount" INTEGER,
    "columns" JSONB,
    "error" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SegmentMaster_tenantId_idx" ON "SegmentMaster"("tenantId");

-- CreateIndex
CREATE INDEX "SegmentMaster_hotelId_kind_idx" ON "SegmentMaster"("hotelId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentMaster_hotelId_kind_code_key" ON "SegmentMaster"("hotelId", "kind", "code");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_idx" ON "Reservation"("tenantId");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_capturedDate_idx" ON "Reservation"("hotelId", "capturedDate");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_checkIn_idx" ON "Reservation"("hotelId", "checkIn");

-- CreateIndex
CREATE INDEX "ReservationNight_tenantId_idx" ON "ReservationNight"("tenantId");

-- CreateIndex
CREATE INDEX "ReservationNight_hotelId_stayDate_idx" ON "ReservationNight"("hotelId", "stayDate");

-- CreateIndex
CREATE INDEX "OnHandSnapshot_tenantId_idx" ON "OnHandSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "OnHandSnapshot_hotelId_stayDate_idx" ON "OnHandSnapshot"("hotelId", "stayDate");

-- CreateIndex
CREATE INDEX "OnHandSnapshot_hotelId_capturedDate_idx" ON "OnHandSnapshot"("hotelId", "capturedDate");

-- CreateIndex
CREATE UNIQUE INDEX "OnHandSnapshot_hotelId_stayDate_capturedDate_key" ON "OnHandSnapshot"("hotelId", "stayDate", "capturedDate");

-- CreateIndex
CREATE INDEX "RoomInventorySnapshot_tenantId_idx" ON "RoomInventorySnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "RoomInventorySnapshot_hotelId_stayDate_idx" ON "RoomInventorySnapshot"("hotelId", "stayDate");

-- CreateIndex
CREATE UNIQUE INDEX "RoomInventorySnapshot_hotelId_roomTypeCode_stayDate_capture_key" ON "RoomInventorySnapshot"("hotelId", "roomTypeCode", "stayDate", "capturedDate");

-- CreateIndex
CREATE INDEX "IngestLog_tenantId_idx" ON "IngestLog"("tenantId");

-- CreateIndex
CREATE INDEX "IngestLog_hotelId_createdAt_idx" ON "IngestLog"("hotelId", "createdAt");

-- AddForeignKey
ALTER TABLE "SegmentMaster" ADD CONSTRAINT "SegmentMaster_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMaster" ADD CONSTRAINT "SegmentMaster_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationNight" ADD CONSTRAINT "ReservationNight_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationNight" ADD CONSTRAINT "ReservationNight_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnHandSnapshot" ADD CONSTRAINT "OnHandSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnHandSnapshot" ADD CONSTRAINT "OnHandSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInventorySnapshot" ADD CONSTRAINT "RoomInventorySnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInventorySnapshot" ADD CONSTRAINT "RoomInventorySnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestLog" ADD CONSTRAINT "IngestLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestLog" ADD CONSTRAINT "IngestLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
