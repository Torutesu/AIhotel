-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "ipAllowlist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "ipRestrictionEnabled" BOOLEAN NOT NULL DEFAULT false;
