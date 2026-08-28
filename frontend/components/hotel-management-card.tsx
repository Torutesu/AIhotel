"use client"

// 施設管理（ユーザー・客室タイプ・競合ホテル）。
// いずれも従来は投入手段がなく、提供側への依頼が必要だった部分。
// ユーザーの新規追加は招待メール（SAAS_DECISIONS.md D-04）で行う。

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AlertCircle, Loader2, RefreshCw, UserPlus, Plus, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  api,
  ApiClientError,
  type ManagedUser,
  type RoomType,
  type Competitor,
  type OtaUrlKey,
} from "@/lib/api"

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "システム管理者",
  MANAGER: "支配人・レベニュー担当",
  OPERATOR: "フロント担当",
}

const OTA_FIELDS: Array<{ key: OtaUrlKey; label: string }> = [
  { key: "rakuten", label: "楽天トラベル" },
  { key: "jalan", label: "じゃらん" },
  { key: "ikkyu", label: "一休.com" },
  { key: "expedia", label: "Expedia" },
  { key: "agoda", label: "Agoda" },
]

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) {
    const detail = err.errors?.map((e) => e.message).join(" / ")
    return detail ? `${err.message}: ${detail}` : err.message
  }
  return fallback
}

/** 読み込み・エラー・再試行の共通表示 */
function SectionState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean
  error: string | null
  onRetry: () => void
  children: React.ReactNode
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          再試行
        </Button>
      </div>
    )
  }
  return <>{children}</>
}

export function HotelManagementCard({
  hotelId,
  canManage,
}: {
  hotelId: string
  canManage: boolean
}) {
  const { toast } = useToast()

  return (
    <Card>
      <CardHeader>
        <CardTitle>施設の管理</CardTitle>
        <CardDescription>
          スタッフ・客室タイプ・競合ホテルを管理します
          {!canManage && "（変更にはMANAGER以上の権限が必要です）"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="users">
          <TabsList className="mb-4">
            <TabsTrigger value="users">スタッフ</TabsTrigger>
            <TabsTrigger value="room-types">客室タイプ</TabsTrigger>
            <TabsTrigger value="competitors">競合ホテル</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <UsersSection hotelId={hotelId} canManage={canManage} toast={toast} />
          </TabsContent>
          <TabsContent value="room-types">
            <RoomTypesSection hotelId={hotelId} canManage={canManage} toast={toast} />
          </TabsContent>
          <TabsContent value="competitors">
            <CompetitorsSection hotelId={hotelId} canManage={canManage} toast={toast} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

type ToastFn = ReturnType<typeof useToast>["toast"]

// ---- スタッフ ----

function UsersSection({
  hotelId,
  canManage,
  toast,
}: {
  hotelId: string
  canManage: boolean
  toast: ToastFn
}) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 招待フォーム
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteName, setInviteName] = useState("")
  const [inviteRole, setInviteRole] = useState<"MANAGER" | "OPERATOR">("OPERATOR")
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setUsers(await api.managedUsers(hotelId))
    } catch (err) {
      setError(errorMessage(err, "スタッフの取得に失敗しました"))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const handleInvite = async () => {
    setInviting(true)
    try {
      await api.inviteUser({ email: inviteEmail, name: inviteName, role: inviteRole, hotelId })
      toast({
        title: "招待メールを送信しました",
        description: `${inviteEmail} 宛にパスワード設定用のリンクを送りました。`,
      })
      setInviteEmail("")
      setInviteName("")
      await load()
    } catch (err) {
      toast({
        title: "招待に失敗しました",
        description: errorMessage(err, undefined as unknown as string),
        variant: "destructive",
      })
    } finally {
      setInviting(false)
    }
  }

  const runUserAction = async (id: string, action: () => Promise<unknown>, successTitle: string) => {
    setBusyId(id)
    try {
      await action()
      toast({ title: successTitle })
      await load()
    } catch (err) {
      toast({
        title: "変更に失敗しました",
        description: errorMessage(err, undefined as unknown as string),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <SectionState loading={loading} error={error} onRetry={load}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3 font-medium">名前</th>
                <th className="py-2 pr-3 font-medium">メールアドレス</th>
                <th className="py-2 pr-3 font-medium">権限</th>
                <th className="py-2 pr-3 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isProvider = user.role === "ADMIN"
                return (
                  <tr key={user.id} className="border-b">
                    <td className="py-2 pr-3">{user.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{user.email}</td>
                    <td className="py-2 pr-3">
                      {isProvider ? (
                        <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
                      ) : (
                        <Select
                          value={user.role}
                          disabled={!canManage || busyId === user.id}
                          onValueChange={(value) =>
                            runUserAction(
                              user.id,
                              () =>
                                api.updateUserRole(user.id, hotelId, value as "MANAGER" | "OPERATOR"),
                              "権限を変更しました"
                            )
                          }
                        >
                          <SelectTrigger className="h-8 w-[210px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MANAGER">{ROLE_LABELS.MANAGER}</SelectItem>
                            <SelectItem value="OPERATOR">{ROLE_LABELS.OPERATOR}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={user.isActive}
                          disabled={!canManage || isProvider || busyId === user.id}
                          onCheckedChange={(checked) =>
                            runUserAction(
                              user.id,
                              () => api.setUserActive(user.id, hotelId, checked),
                              checked ? "有効化しました" : "無効化しました"
                            )
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {user.isActive ? "有効" : "無効"}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionState>

      {canManage && (
        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">スタッフを招待</p>
            <p className="text-xs text-muted-foreground">
              招待メールのリンクから本人がパスワードを設定します。こちらでパスワードを決める必要はありません。
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="invite-name">名前</Label>
              <Input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="山田 太郎"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-email">メールアドレス</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role">権限</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "MANAGER" | "OPERATOR")}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERATOR">{ROLE_LABELS.OPERATOR}</SelectItem>
                  <SelectItem value="MANAGER">{ROLE_LABELS.MANAGER}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              className="gap-2"
              disabled={inviting || !inviteEmail || !inviteName}
              onClick={handleInvite}
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              招待を送る
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 客室タイプ ----

function RoomTypesSection({
  hotelId,
  canManage,
  toast,
}: {
  hotelId: string
  canManage: boolean
  toast: ToastFn
}) {
  const [rows, setRows] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ code: "", name: "", capacity: 2, count: 10 })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await api.roomTypes(hotelId))
    } catch (err) {
      setError(errorMessage(err, "客室タイプの取得に失敗しました"))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const totalRooms = rows.reduce((sum, r) => sum + r.count, 0)

  const handleCreate = async () => {
    setSaving(true)
    try {
      await api.createRoomType({ hotelId, ...form, sortOrder: rows.length + 1 })
      toast({ title: "客室タイプを追加しました" })
      setForm({ code: "", name: "", capacity: 2, count: 10 })
      await load()
    } catch (err) {
      toast({
        title: "追加に失敗しました",
        description: errorMessage(err, undefined as unknown as string),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (id: string) => {
    try {
      await api.deactivateRoomType(id, hotelId)
      toast({ title: "客室タイプを無効化しました" })
      await load()
    } catch (err) {
      toast({
        title: "無効化に失敗しました",
        description: errorMessage(err, undefined as unknown as string),
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-5">
      <SectionState loading={loading} error={error} onRetry={load}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3 font-medium">コード</th>
                <th className="py-2 pr-3 font-medium">名称</th>
                <th className="py-2 pr-3 font-medium text-right">定員</th>
                <th className="py-2 pr-3 font-medium text-right">室数</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="py-2 pr-3 font-mono text-xs">{row.code}</td>
                  <td className="py-2 pr-3">{row.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.capacity}名</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.count}室</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canManage}
                      onClick={() => handleDeactivate(row.id)}
                      aria-label={`${row.name}を無効化`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          登録室数の合計: {totalRooms}室。ホテル情報の総客室数と一致しているか確認してください
        </p>
      </SectionState>

      {canManage && (
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">客室タイプを追加</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rt-code">コード</Label>
              <Input
                id="rt-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="STD_TWIN"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-name">名称</Label>
              <Input
                id="rt-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="スタンダードツイン"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-capacity">定員</Label>
              <Input
                id="rt-capacity"
                type="number"
                min={1}
                max={10}
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: Number.parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-count">室数</Label>
              <Input
                id="rt-count"
                type="number"
                min={0}
                value={form.count}
                onChange={(e) => setForm({ ...form, count: Number.parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            コードは大文字英数字とアンダースコアのみ。実績データと紐づくため後から変更できません
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              className="gap-2"
              disabled={saving || !form.code || !form.name}
              onClick={handleCreate}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              追加
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 競合ホテル ----

function CompetitorsSection({
  hotelId,
  canManage,
  toast,
}: {
  hotelId: string
  canManage: boolean
  toast: ToastFn
}) {
  const [rows, setRows] = useState<Competitor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [urls, setUrls] = useState<Partial<Record<OtaUrlKey, string>>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await api.competitors(hotelId))
    } catch (err) {
      setError(errorMessage(err, "競合ホテルの取得に失敗しました"))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const startEditing = (competitor: Competitor) => {
    setEditing(competitor.id)
    const initial: Partial<Record<OtaUrlKey, string>> = {}
    for (const field of OTA_FIELDS) {
      initial[field.key] = competitor.otaUrls?.[field.key] ?? ""
    }
    setUrls(initial)
  }

  const handleCreate = async () => {
    setSaving(true)
    try {
      await api.createCompetitor({ hotelId, name, category: category || undefined })
      toast({ title: "競合ホテルを追加しました" })
      setName("")
      setCategory("")
      await load()
    } catch (err) {
      toast({
        title: "追加に失敗しました",
        description: errorMessage(err, undefined as unknown as string),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveUrls = async (id: string) => {
    setSaving(true)
    try {
      await api.updateCompetitor(id, hotelId, { otaUrls: urls })
      toast({ title: "OTAのURLを保存しました" })
      setEditing(null)
      await load()
    } catch (err) {
      toast({
        title: "保存に失敗しました",
        description: errorMessage(err, undefined as unknown as string),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <SectionState loading={loading} error={error} onRetry={load}>
        <div className="space-y-3">
          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              競合ホテルが登録されていません。登録すると競合価格の比較が使えるようになります。
            </p>
          )}
          {rows.map((competitor) => {
            const registered = OTA_FIELDS.filter((f) => competitor.otaUrls?.[f.key]).length
            return (
              <div key={competitor.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{competitor.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {competitor.category || "カテゴリ未設定"} ・ OTA URL {registered}/
                      {OTA_FIELDS.length} 件登録済み
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        editing === competitor.id ? setEditing(null) : startEditing(competitor)
                      }
                    >
                      {editing === competitor.id ? "閉じる" : "OTA URLを編集"}
                    </Button>
                  )}
                </div>

                {editing === competitor.id && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {OTA_FIELDS.map((field) => (
                        <div key={field.key} className="space-y-1">
                          <Label htmlFor={`ota-${competitor.id}-${field.key}`}>{field.label}</Label>
                          <Input
                            id={`ota-${competitor.id}-${field.key}`}
                            value={urls[field.key] ?? ""}
                            onChange={(e) => setUrls({ ...urls, [field.key]: e.target.value })}
                            placeholder="https://..."
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      空欄のままにすると未設定として保存されます
                    </p>
                    <div className="flex justify-end">
                      <Button size="sm" disabled={saving} onClick={() => handleSaveUrls(competitor.id)}>
                        {saving && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SectionState>

      {canManage && (
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">競合ホテルを追加</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="comp-name">ホテル名</Label>
              <Input
                id="comp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="○○ホテル東京"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="comp-category">カテゴリ</Label>
              <Input
                id="comp-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="同カテゴリ / 上位カテゴリ など"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="gap-2" disabled={saving || !name} onClick={handleCreate}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              追加
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
