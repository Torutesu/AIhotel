-- CreateTable
CREATE TABLE "DailyBudget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "budgetRooms" INTEGER,
    "budgetRevenue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyBudget_tenantId_idx" ON "DailyBudget"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBudget_hotelId_date_key" ON "DailyBudget"("hotelId", "date");

-- AddForeignKey
ALTER TABLE "DailyBudget" ADD CONSTRAINT "DailyBudget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBudget" ADD CONSTRAINT "DailyBudget_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
