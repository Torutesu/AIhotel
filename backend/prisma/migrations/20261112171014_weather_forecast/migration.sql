-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "weatherAreaCode" TEXT;

-- CreateTable
CREATE TABLE "WeatherForecast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "areaCode" TEXT NOT NULL,
    "weatherCode" TEXT NOT NULL,
    "weatherText" TEXT,
    "pop" INTEGER,
    "tempMax" DOUBLE PRECISION,
    "tempMin" DOUBLE PRECISION,
    "reliability" TEXT,
    "source" TEXT NOT NULL DEFAULT 'jma',
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherForecast_tenantId_idx" ON "WeatherForecast"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherForecast_hotelId_date_key" ON "WeatherForecast"("hotelId", "date");

-- AddForeignKey
ALTER TABLE "WeatherForecast" ADD CONSTRAINT "WeatherForecast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherForecast" ADD CONSTRAINT "WeatherForecast_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
