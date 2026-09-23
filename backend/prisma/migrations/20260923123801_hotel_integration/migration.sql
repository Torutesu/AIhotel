-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('PMS', 'SITE_CONTROLLER');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('PLANNED', 'TESTING', 'ACTIVE');

-- CreateTable
CREATE TABLE "HotelIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "product" TEXT NOT NULL,
    "connectionMethod" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotelIntegration_tenantId_idx" ON "HotelIntegration"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "HotelIntegration_hotelId_kind_key" ON "HotelIntegration"("hotelId", "kind");

-- AddForeignKey
ALTER TABLE "HotelIntegration" ADD CONSTRAINT "HotelIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotelIntegration" ADD CONSTRAINT "HotelIntegration_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
