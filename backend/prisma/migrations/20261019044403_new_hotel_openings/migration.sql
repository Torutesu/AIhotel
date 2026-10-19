-- CreateTable
CREATE TABLE "NewHotelOpening" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "openingDate" DATE NOT NULL,
    "rooms" INTEGER,
    "category" TEXT,
    "location" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "expectedImpact" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewHotelOpening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewHotelOpening_tenantId_idx" ON "NewHotelOpening"("tenantId");

-- CreateIndex
CREATE INDEX "NewHotelOpening_hotelId_openingDate_idx" ON "NewHotelOpening"("hotelId", "openingDate");

-- AddForeignKey
ALTER TABLE "NewHotelOpening" ADD CONSTRAINT "NewHotelOpening_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewHotelOpening" ADD CONSTRAINT "NewHotelOpening_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
