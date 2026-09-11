-- AiPriceRecommendation のホテル全体行（roomTypeId IS NULL）の重複を DB 側で防ぐ（C-4）。
--
-- @@unique([hotelId, date, roomTypeId]) は PostgreSQL では NULL 同士が等しいとみなされないため、
-- roomTypeId が NULL の行は何件でも作れてしまう。並行して需要予測を再計算すると
-- 同一日の推奨が複数行でき、料金カレンダーに同じ日が二重に表示される。
--
-- 部分ユニーク索引（WHERE 句付き）は schema.prisma では表現できないため、
-- この手書きマイグレーションで維持する。schema.prisma を変更しても
-- prisma migrate diff はこの索引を落とさない（Prisma が管理対象外として無視する）。

-- 既存の重複行を先に掃除する。各 (hotelId, date) について computedAt が最も新しい1行だけ残す。
DELETE FROM "AiPriceRecommendation" a
USING "AiPriceRecommendation" b
WHERE a."roomTypeId" IS NULL
  AND b."roomTypeId" IS NULL
  AND a."hotelId" = b."hotelId"
  AND a."date" = b."date"
  AND (a."computedAt", a."id") < (b."computedAt", b."id");

CREATE UNIQUE INDEX "AiPriceRecommendation_hotelId_date_null_roomtype_key"
  ON "AiPriceRecommendation" ("hotelId", "date")
  WHERE "roomTypeId" IS NULL;
