-- 同じホテル・同じ名前・同じ開業日の行が既にあれば、最後に更新した行だけを残す（一意制約を張る前に）
DELETE FROM "NewHotelOpening" a
USING "NewHotelOpening" b
WHERE a."hotelId" = b."hotelId"
  AND a."name" = b."name"
  AND a."openingDate" = b."openingDate"
  AND (a."updatedAt" < b."updatedAt" OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id"));

-- CreateIndex
CREATE UNIQUE INDEX "NewHotelOpening_hotelId_name_openingDate_key" ON "NewHotelOpening"("hotelId", "name", "openingDate");
