-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "excludedFromPricing" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FactorCoefficient" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB,
    "rulesErrors" JSONB,
    "rulesAppliedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocumentRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "rules" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_idx" ON "KnowledgeDocument"("tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_hotelId_idx" ON "KnowledgeDocument"("hotelId");

-- CreateIndex
CREATE INDEX "KnowledgeDocumentRevision_tenantId_idx" ON "KnowledgeDocumentRevision"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocumentRevision_documentId_version_key" ON "KnowledgeDocumentRevision"("documentId", "version");

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentRevision" ADD CONSTRAINT "KnowledgeDocumentRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentRevision" ADD CONSTRAINT "KnowledgeDocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
