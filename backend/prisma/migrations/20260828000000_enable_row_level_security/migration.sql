-- テナント分離を DB レイヤーで強制する（SAAS_DECISIONS.md D-01）
--
-- アプリのバグでテナント間データが混ざることを構造的に防ぐ。
-- 判定は2つのセッション変数のみで行う:
--   app.tenant_id … 現在のリクエストのテナント。アプリが SET LOCAL で毎回設定する
--   app.bypass    … 'on' のときのみ全テナント横断（提供側ADMIN・ログイン前のユーザー検索用）
--
-- current_setting(..., true) は未設定時に NULL を返し、NULL との比較は真にならないため、
-- テナントを設定し忘れたクエリは「0件」になる（fail-closed）。
--
-- 【重要】この仕組みは接続ロールが superuser でも BYPASSRLS でもない場合にのみ機能する。
-- アプリ用ロールの作成手順は prisma/rls-role.sql を参照。

ALTER TABLE "AiComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiComment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiComment"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AiPriceRecommendation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiPriceRecommendation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiPriceRecommendation"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "Alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Alert" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Alert"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "BookingCurveData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingCurveData" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BookingCurveData"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Campaign"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "Competitor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Competitor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Competitor"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "CompetitorPriceData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompetitorPriceData" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompetitorPriceData"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "DailyData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyData" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DailyData"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "DailyRoomData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyRoomData" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DailyRoomData"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Event"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "GroupBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupBooking" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GroupBooking"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "Hotel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Hotel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Hotel"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "KpiSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KpiSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KpiSnapshot"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "MonthlyBudget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyBudget" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MonthlyBudget"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "MonthlyLandingSimulation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyLandingSimulation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MonthlyLandingSimulation"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "OtaChannelData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtaChannelData" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OtaChannelData"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "PriceRank" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceRank" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PriceRank"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "PricingStrategyConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PricingStrategyConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PricingStrategyConfig"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RefreshToken"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "ReviewScore" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewScore" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReviewScore"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "RoomType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoomType" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RoomType"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

-- Tenant 自身は id で判定する（テナント一覧＝顧客企業名の流出を防ぐ）
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING ("id" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("id" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');
