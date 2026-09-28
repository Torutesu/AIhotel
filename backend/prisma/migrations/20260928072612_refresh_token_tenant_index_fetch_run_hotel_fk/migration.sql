-- CreateIndex
CREATE INDEX "RefreshToken_tenantId_idx" ON "RefreshToken"("tenantId");

-- 削除済みホテルの取得履歴（外部キーが無かったため残っている行）を先に消す。
-- 観測値の runId は ON DELETE SET NULL なので、観測値そのものは残る（R-3-4）
DELETE FROM "CompetitorFetchRun" r WHERE NOT EXISTS (SELECT 1 FROM "Hotel" h WHERE h."id" = r."hotelId");

-- AddForeignKey
ALTER TABLE "CompetitorFetchRun" ADD CONSTRAINT "CompetitorFetchRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
