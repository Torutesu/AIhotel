"use client"

// アクセスできるホテルが0件のときの画面（#81）。
// 以前はどのタブも「ホテル情報を読み込んでいます...」のまま先に進めなかった。
//
// - 管理者（ADMIN）: その場で最初のホテルを作れる
// - 運営（PLATFORM_ADMIN）: テナント管理を表示する（ホテルはテナントの管理者が作る）
// - それ以外: 管理者への連絡を案内する

import { useState } from "react"
import { Building2, LogOut } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { HotelCreateForm, type HotelCreateValues } from "@/components/settings/hotel-create-form"
import { TenantManagementSection } from "@/components/settings/tenant-management-section"
import { api, ApiClientError } from "@/lib/api"
import { ROLE_LABELS } from "@shared/types"

export function NoHotelState() {
  const { user, logout, reloadHotels, selectHotel } = useAuth()
  const [saving, setSaving] = useState(false)

  const handleCreate = async (values: HotelCreateValues) => {
    setSaving(true)
    try {
      const hotel = await api.createHotel({
        name: values.name,
        totalRooms: values.totalRooms,
        address: values.address || undefined,
      })
      toast.success(`「${hotel.name}」を作成しました`)
      await reloadHotels()
      selectHotel(hotel.id)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "ホテルの作成に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">初期設定</h1>
            <p className="text-sm text-muted-foreground">
              {user?.name}（{user ? ROLE_LABELS[user.role] : ""}）としてログインしています
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" aria-hidden />
            ログアウト
          </Button>
        </div>

        {user?.role === "ADMIN" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-5 w-5" aria-hidden />
                最初のホテルを登録してください
              </CardTitle>
              <CardDescription>
                ホテルを登録すると、ダッシュボード・プライシング・分析などの画面が使えるようになります。
                料金ランク・予算・競合ホテルは、登録後に設定タブから追加できます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HotelCreateForm saving={saving} onSubmit={handleCreate} idPrefix="first-hotel" />
            </CardContent>
          </Card>
        ) : user?.role === "PLATFORM_ADMIN" ? (
          <>
            <p className="text-sm text-muted-foreground">
              まだホテルがありません。テナントを作成し、そのテナントの管理者を登録してください。
              ホテルはテナントの管理者がログインして登録します。
            </p>
            <TenantManagementSection />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">利用できるホテルがありません</CardTitle>
              <CardDescription>
                このアカウントにはまだホテルが割り当てられていません。所属先の管理者に、
                ホテルの登録またはアカウントへのホテルの割り当てを依頼してください。
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  )
}
