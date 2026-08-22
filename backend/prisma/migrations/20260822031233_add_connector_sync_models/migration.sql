-- CreateEnum
CREATE TYPE "SyncTarget" AS ENUM ('LINCOLN', 'NEHOPPS');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AgentDeviceRole" AS ENUM ('PRIMARY', 'STANDBY');

-- CreateEnum
CREATE TYPE "SnapshotKind" AS ENUM ('READ_RAW', 'PRE_WRITE', 'POST_WRITE', 'FAILURE_EVIDENCE');

-- CreateTable
CREATE TABLE "AgentDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AgentDeviceRole" NOT NULL DEFAULT 'PRIMARY',
    "tokenHash" TEXT NOT NULL,
    "tokenRotatedAt" TIMESTAMP(3),
    "agentVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPairingCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceRole" "AgentDeviceRole" NOT NULL DEFAULT 'PRIMARY',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "target" "SyncTarget" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "notBefore" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedById" TEXT,
    "deviceId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "jobId" TEXT,
    "target" "SyncTarget" NOT NULL,
    "kind" "SnapshotKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'text/html',
    "contentHash" TEXT NOT NULL,
    "sanitized" BOOLEAN NOT NULL DEFAULT false,
    "extracted" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotelSyncState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "lastSuccessfulReadAt" TIMESTAMP(3),
    "lastSuccessfulWriteAt" TIMESTAMP(3),
    "consecutiveReadFails" INTEGER NOT NULL DEFAULT 0,
    "writeFrozen" BOOLEAN NOT NULL DEFAULT false,
    "writeFrozenReason" TEXT,
    "manualModeActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsAlertState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "firstFiredAt" TIMESTAMP(3) NOT NULL,
    "lastFiredAt" TIMESTAMP(3) NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "fireCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsAlertState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentDevice_tokenHash_key" ON "AgentDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentDevice_tenantId_idx" ON "AgentDevice"("tenantId");

-- CreateIndex
CREATE INDEX "AgentDevice_hotelId_idx" ON "AgentDevice"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPairingCode_codeHash_key" ON "AgentPairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "AgentPairingCode_tenantId_idx" ON "AgentPairingCode"("tenantId");

-- CreateIndex
CREATE INDEX "AgentPairingCode_hotelId_idx" ON "AgentPairingCode"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_idempotencyKey_key" ON "SyncJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncJob_tenantId_idx" ON "SyncJob"("tenantId");

-- CreateIndex
CREATE INDEX "SyncJob_hotelId_status_idx" ON "SyncJob"("hotelId", "status");

-- CreateIndex
CREATE INDEX "SyncJob_status_notBefore_idx" ON "SyncJob"("status", "notBefore");

-- CreateIndex
CREATE INDEX "SyncSnapshot_tenantId_idx" ON "SyncSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "SyncSnapshot_hotelId_kind_capturedAt_idx" ON "SyncSnapshot"("hotelId", "kind", "capturedAt");

-- CreateIndex
CREATE INDEX "SyncSnapshot_deleteAfter_idx" ON "SyncSnapshot"("deleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "HotelSyncState_hotelId_key" ON "HotelSyncState"("hotelId");

-- CreateIndex
CREATE INDEX "HotelSyncState_tenantId_idx" ON "HotelSyncState"("tenantId");

-- CreateIndex
CREATE INDEX "OpsAlertState_tenantId_idx" ON "OpsAlertState"("tenantId");

-- CreateIndex
CREATE INDEX "OpsAlertState_resolvedAt_idx" ON "OpsAlertState"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpsAlertState_hotelId_eventKey_key" ON "OpsAlertState"("hotelId", "eventKey");

-- AddForeignKey
ALTER TABLE "AgentDevice" ADD CONSTRAINT "AgentDevice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDevice" ADD CONSTRAINT "AgentDevice_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPairingCode" ADD CONSTRAINT "AgentPairingCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPairingCode" ADD CONSTRAINT "AgentPairingCode_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AgentDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncSnapshot" ADD CONSTRAINT "SyncSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncSnapshot" ADD CONSTRAINT "SyncSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncSnapshot" ADD CONSTRAINT "SyncSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotelSyncState" ADD CONSTRAINT "HotelSyncState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotelSyncState" ADD CONSTRAINT "HotelSyncState_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
