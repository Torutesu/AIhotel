// 運営・管理者向けの API（#91 で index.ts から分割）。
// 実績の取り込み（#82）、ホテル・部屋タイプ・テナントの管理（#81）、一時パスワード・監査ログ（#89）。
// index.ts の api オブジェクトに展開されるので、画面からは api.xxx で呼ぶ。

import type {
  HotelDto as Hotel, RoomType, RoomTypeInput, TenantSummary, AuditLogItem, TemporaryPasswordResult,
  TrialSummary, CreateTrialRequest, UpdateTrialRequest, TrialCredentials, IpAllowEntry, IpRestrictionSettings
} from "@shared/types"
import { rawBinaryRequest, rawRequest, withDemoFallback, type BinaryDownload } from "./client"
import { demoAdmin, demoTrials } from "./demo-admin"
import { mockAuditLogs, mockRoomTypes } from "./demo-data"
import type { CompetitorPriceCsvRow, OtbCsvRow } from "@/lib/import-csv"
import type {
  CopyableSettingsItem, HotelIntegration, HotelIntegrationInput, IntegrationKind, SetupWorkbookResult
} from "./types"

export const adminEndpoints = {
  // ---- 実績データの取り込み（#82） ----

  /**
   * 日次実績の一括取り込み（MANAGER 以上、1回1,000行まで）。
   * dryRun: true なら検証と件数の集計だけ。不正な行があると 400 で、行ごとのエラーは
   * ApiClientError.fieldErrors（field は "rows.<index>.<項目>"）に入る
   */
  importDailyData(
    hotelId: string,
    rows: Array<{ date: string; soldRooms: number; totalRevenue: number; guests: number | null }>,
    dryRun: boolean,
  ): Promise<{ dryRun: boolean; total: number; created: number; updated: number; startDate: string; endDate: string }> {
    return rawRequest("/api/v1/imports/daily-data", {
      method: "POST",
      body: JSON.stringify({ hotelId, rows, dryRun }),
    })
  },

  /**
   * 競合価格の一括取り込み（#9。MANAGER 以上、1回5,000行まで）。
   * 同じ競合・同じ日に複数の取得元があれば、人数ごとの最安値にまとめて保存される（aggregated がその件数）
   */
  importCompetitorPrices(
    hotelId: string,
    rows: CompetitorPriceCsvRow[],
    dryRun: boolean,
  ): Promise<{ dryRun: boolean; total: number; aggregated: number; created: number; updated: number; startDate: string; endDate: string }> {
    return rawRequest("/api/v1/imports/competitor-prices", {
      method: "POST",
      body: JSON.stringify({ hotelId, rows, dryRun }),
    })
  },

  /**
   * OTB（その時点の予約積上室数）の取り込み（#24 E2。MANAGER 以上、1回1,000行まで）。
   * capturedDate を省略すると今日時点の予約数として保存される
   */
  importOtb(
    hotelId: string,
    rows: OtbCsvRow[],
    dryRun: boolean,
    capturedDate?: string,
  ): Promise<{ dryRun: boolean; capturedDate: string; total: number; created: number; updated: number; startDate: string; endDate: string }> {
    return rawRequest("/api/v1/imports/otb", {
      method: "POST",
      body: JSON.stringify({ hotelId, rows, dryRun, capturedDate }),
    })
  },

  // ---- 初期設定を速くする仕組み（#13） ----

  /** 連携先（PMS・サイトコントローラー）の記録 */
  integrations(hotelId: string): Promise<HotelIntegration[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/settings/integrations?hotelId=${hotelId}`),
      () => []
    )
  },

  saveIntegration(input: HotelIntegrationInput & { hotelId: string }): Promise<HotelIntegration> {
    return rawRequest("/api/v1/settings/integrations", { method: "PUT", body: JSON.stringify(input) })
  },

  deleteIntegration(hotelId: string, kind: IntegrationKind): Promise<void> {
    return rawRequest(`/api/v1/settings/integrations/${kind}?hotelId=${hotelId}`, { method: "DELETE" })
  },

  /** 同じテナントの既存ホテルから設定を複製する（複製先に既にある項目は 400） */
  copyHotelSettings(
    hotelId: string,
    sourceHotelId: string,
    items: CopyableSettingsItem[],
  ): Promise<{ copied: Partial<Record<CopyableSettingsItem, number>> }> {
    return rawRequest("/api/v1/settings/copy-from", {
      method: "POST",
      body: JSON.stringify({ hotelId, sourceHotelId, items }),
    })
  },

  /** 現在の設定を埋めた初期設定シート（Excel） */
  downloadSetupWorkbook(hotelId: string): Promise<BinaryDownload> {
    return rawBinaryRequest(`/api/v1/hotels/${hotelId}/setup-workbook`)
  },

  /** 初期設定シートの取り込み。不正な箇所は ApiClientError.fieldErrors（field は「シート名!行番号」） */
  importSetupWorkbook(hotelId: string, fileBase64: string, dryRun: boolean): Promise<SetupWorkbookResult> {
    return rawRequest(`/api/v1/hotels/${hotelId}/setup-workbook`, {
      method: "POST",
      body: JSON.stringify({ fileBase64, dryRun }),
    })
  },

  // ---- ホテル・部屋タイプ・テナント（#81） ----

  /** ホテルの作成（ADMIN 以上）。作成先は呼び出し元のテナント。運営は tenantId を指定する */
  createHotel(input: {
    name: string
    totalRooms: number
    address?: string
    phone?: string
    email?: string
    tenantId?: string
  }): Promise<Hotel> {
    return rawRequest("/api/v1/hotels", { method: "POST", body: JSON.stringify(input) })
  },

  /** ホテルの削除（ADMIN 以上・論理削除） */
  deleteHotel(hotelId: string): Promise<void> {
    return rawRequest(`/api/v1/hotels/${hotelId}`, { method: "DELETE" })
  },

  roomTypes(hotelId: string): Promise<RoomType[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/settings/room-types?hotelId=${hotelId}`),
      () => mockRoomTypes(hotelId)
    )
  },

  /** 部屋タイプの登録（MANAGER 以上）。削除済みの同じコードは復活する */
  createRoomType(hotelId: string, input: RoomTypeInput): Promise<RoomType> {
    return rawRequest("/api/v1/settings/room-types", {
      method: "POST",
      body: JSON.stringify({ hotelId, ...input }),
    })
  },

  updateRoomType(id: string, hotelId: string, input: Partial<RoomTypeInput>): Promise<RoomType> {
    return rawRequest(`/api/v1/settings/room-types/${id}?hotelId=${hotelId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  deleteRoomType(id: string, hotelId: string): Promise<void> {
    return rawRequest(`/api/v1/settings/room-types/${id}?hotelId=${hotelId}`, { method: "DELETE" })
  },

  /** テナント一覧（運営のみ） */
  tenants(): Promise<TenantSummary[]> {
    return withDemoFallback(() => rawRequest("/api/v1/platform/tenants"), () => demoAdmin.tenants())
  },

  createTenant(input: { name: string; code: string }): Promise<TenantSummary> {
    return withDemoFallback(
      () => rawRequest("/api/v1/platform/tenants", { method: "POST", body: JSON.stringify(input) }),
      () => demoAdmin.createTenant(input),
    )
  },

  /** テナントの名称変更・契約停止（isActive: false）／再開（運営のみ） */
  updateTenant(id: string, input: { name?: string; isActive?: boolean }): Promise<TenantSummary> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/platform/tenants/${id}`, { method: "PUT", body: JSON.stringify(input) }),
      () => demoAdmin.updateTenant(id, input),
    )
  },

  /** IP 制限で締め出されたテナントの復旧（運営のみ — #12）。許可リストは残し、制限だけを無効にする */
  disableTenantIpRestriction(id: string): Promise<void> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/platform/tenants/${id}/disable-ip-restriction`, { method: "POST" }),
      () => demoAdmin.disableTenantIpRestriction(id),
    )
  },

  // ---- IP 制限（テナントの管理者 — #12） ----

  /** 自テナントの IP 制限の設定と、呼び出した本人のアクセス元 IP */
  ipRestriction(): Promise<IpRestrictionSettings> {
    return withDemoFallback(() => rawRequest("/api/v1/settings/ip-restriction"), () => demoAdmin.ipRestriction())
  },

  /** IP 制限の保存。有効にするとき、自分のアクセス元が許可リストに無ければ 400（締め出し防止） */
  updateIpRestriction(input: { enabled: boolean; entries: IpAllowEntry[] }): Promise<IpRestrictionSettings> {
    return withDemoFallback(
      () => rawRequest("/api/v1/settings/ip-restriction", { method: "PUT", body: JSON.stringify(input) }),
      () => demoAdmin.updateIpRestriction(input),
    )
  },

  // ---- トライアル（デモ）アカウント（運営のみ） ----

  /** トライアルの一覧（期限の近い順） */
  trials(): Promise<TrialSummary[]> {
    return withDemoFallback(() => rawRequest("/api/v1/platform/trials"), () => demoTrials.trials())
  },

  /** トライアルの発行。デモデータ入りの専用ホテルとログイン ID を作る。パスワードはこの戻り値でしか得られない */
  createTrial(input: CreateTrialRequest): Promise<TrialCredentials> {
    return withDemoFallback(
      () => rawRequest("/api/v1/platform/trials", { method: "POST", body: JSON.stringify(input) }),
      () => demoTrials.createTrial(input),
    )
  },

  /** 名前・メモの変更、停止／再開、期限の延長 */
  updateTrial(id: string, input: UpdateTrialRequest): Promise<TrialSummary> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/platform/trials/${id}`, { method: "PUT", body: JSON.stringify(input) }),
      () => demoTrials.updateTrial(id, input),
    )
  },

  /** ログイン用パスワードの再発行。新しいパスワードはこの戻り値でしか得られない */
  resetTrialPassword(id: string): Promise<TrialCredentials> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/platform/trials/${id}/reset-password`, { method: "POST" }),
      () => demoTrials.resetTrialPassword(id),
    )
  },

  /** トライアルの削除（デモデータごと消す） */
  deleteTrial(id: string): Promise<void> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/platform/trials/${id}`, { method: "DELETE" }),
      () => demoTrials.deleteTrial(id),
    )
  },

  /**
   * 一時パスワードの発行（ADMIN / MANAGER — #89）。メール送信が有効なら本人にメールで届き、
   * 戻り値の temporaryPassword は null。届けられなかったときだけ、この戻り値で1回だけ得られる
   */
  resetUserPassword(id: string): Promise<TemporaryPasswordResult> {
    return rawRequest(`/api/v1/users/${id}/reset-password`, { method: "POST" })
  },

  /** 監査ログ（ADMIN 以上 — #89）。nextCursor を cursor に渡すと続きを取れる */
  auditLogs(params: {
    hotelId: string
    action?: string
    from?: string
    to?: string
    cursor?: string
  }): Promise<{ items: AuditLogItem[]; nextCursor: string | null }> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
    return withDemoFallback(
      () => rawRequest(`/api/v1/audit-logs?${query.toString()}`),
      () => mockAuditLogs(params.action)
    )
  },
}
