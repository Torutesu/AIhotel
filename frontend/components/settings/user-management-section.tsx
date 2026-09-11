"use client"

// ユーザー管理（X-3 / N-3 / #62）
//
// GET /users?hotelId= は ADMIN / MANAGER のみ（OPERATOR は 403）なので、
// このセクション自体を ADMIN / MANAGER にしか描画しない。
//
// 一覧は「いま見ているホテルが属するテナント」のユーザーだけ。ADMIN は
// テナント管理者であり、他テナントのユーザーは API 側でも見えない（#62）。
//
// バックエンドの不変条件を UI 側でも先回りして無効化する:
//  - 運営（PLATFORM_ADMIN）ユーザーの操作と運営ロールの付与は運営のみ
//  - MANAGER は ADMIN ユーザーを操作できず、ADMIN ロールも付与できない
//  - 自分自身のロール変更・無効化はできない
// それでも 400/403 が返った場合はバックエンドのメッセージをそのまま表示する。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import {
  NO_HOTEL_VALUE,
  UserInviteDialog,
  type InviteFormValues,
} from "@/components/settings/user-invite-dialog"
import { api, ApiClientError } from "@/lib/api"
// ロール表示名は @shared/types の ROLE_LABELS を唯一の出所とする（#62）
import { ROLE_LABELS, ROLE_ORDER, type User, type UserRole } from "@shared/types"

export function UserManagementSection() {
  const { hotelId, hotels, user } = useAuth()
  /** 運営（PLATFORM_ADMIN）。運営ロールの表示・付与を許すのはこのロールだけ */
  const isPlatformAdmin = user?.role === "PLATFORM_ADMIN"
  /** テナント管理者以上（運営を含む）。ADMIN ユーザーの操作・ADMIN ロールの付与ができる */
  const isAdmin = isPlatformAdmin || user?.role === "ADMIN"
  const canManageUsers = isAdmin || user?.role === "MANAGER"

  /** そのロールを選択肢に出せるか（運営ロールは運営にだけ見せる） */
  const canAssignRole = useCallback(
    (role: UserRole): boolean => {
      if (role === "PLATFORM_ADMIN") return isPlatformAdmin
      if (role === "ADMIN") return isAdmin
      return true
    },
    [isAdmin, isPlatformAdmin],
  )

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [pendingDeactivate, setPendingDeactivate] = useState<User | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setUsers(await api.users(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ユーザーの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    if (!canManageUsers) return
    load()
  }, [canManageUsers, load])

  const roleOptions = useMemo(
    () =>
      ROLE_ORDER.filter(canAssignRole).map((role) => ({
        value: role,
        label: ROLE_LABELS[role],
      })),
    [canAssignRole],
  )

  const hotelName = useCallback(
    (targetHotelId: string | null | undefined): string => {
      if (!targetHotelId) return "指定なし（テナント内の全ホテル）"
      return hotels.find((h) => h.id === targetHotelId)?.name ?? "他ホテル"
    },
    [hotels],
  )

  /**
   * そのユーザーを操作できるか。
   * 運営ユーザーは運営だけが、ADMIN ユーザーは ADMIN 以上だけが操作できる（#62）
   */
  const canEditUser = (target: User): boolean => {
    if (target.role === "PLATFORM_ADMIN") return isPlatformAdmin
    if (target.role === "ADMIN") return isAdmin
    return true
  }

  /** 操作できない理由（title 属性に出す） */
  const notEditableReason = (target: User): string =>
    target.role === "PLATFORM_ADMIN"
      ? "運営ユーザーを変更できるのは運営のみです"
      : "管理者ユーザーを変更できるのは管理者のみです"

  const isSelf = (target: User): boolean => target.id === user?.id

  const changeRole = async (target: User, role: UserRole) => {
    if (role === target.role) return
    setUpdatingId(target.id)
    try {
      const updated = await api.updateUser(target.id, { role })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      toast.success(`${updated.name} のロールを変更しました`)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "ロールの変更に失敗しました")
      // 失敗時は表示を実データに戻す
      await load()
    } finally {
      setUpdatingId(null)
    }
  }

  const setActive = async (target: User, isActive: boolean) => {
    setUpdatingId(target.id)
    try {
      const updated = await api.updateUser(target.id, { isActive })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      toast.success(isActive ? `${updated.name} を有効化しました` : `${updated.name} を無効化しました`)
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : isActive
            ? "有効化に失敗しました"
            : "無効化に失敗しました",
      )
      await load()
    } finally {
      setUpdatingId(null)
    }
  }

  const handleInvite = async (values: InviteFormValues) => {
    setInviting(true)
    try {
      await api.registerUser({
        email: values.email.trim(),
        name: values.name.trim(),
        password: values.password,
        role: values.role,
        ...(values.hotelId !== NO_HOTEL_VALUE && { hotelId: values.hotelId }),
      })
      toast.success("ユーザーを招待しました", {
        description: "初期パスワードを本人に共有してください。",
      })
      setInviteOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "ユーザーの招待に失敗しました")
    } finally {
      setInviting(false)
    }
  }

  // OPERATOR にはこのセクションを出さない（GET /users が 403 になるため）
  if (!canManageUsers) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>ユーザー管理</CardTitle>
            <CardDescription>
              同じテナントのユーザーの一覧・招待・ロール変更・有効/無効を管理します（現在{" "}
              {users.length} 名）
              {!isAdmin && "。管理者ユーザーの変更と管理者ロールの付与は管理者のみ行えます"}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setInviteOpen(true)}
            disabled={loading || !hotelId}
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            ユーザーを招待
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            ユーザーが登録されていません。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">名前</th>
                  <th className="px-3 py-2 text-left font-medium">メールアドレス</th>
                  <th className="px-3 py-2 text-left font-medium">ロール</th>
                  <th className="px-3 py-2 text-left font-medium">所属ホテル</th>
                  <th className="px-3 py-2 text-left font-medium">状態</th>
                  <th className="px-3 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((target) => {
                  const editable = canEditUser(target)
                  const self = isSelf(target)
                  const busy = updatingId === target.id
                  const roleDisabled = !editable || self || busy
                  return (
                    <tr key={target.id} className="border-b hover:bg-muted/50">
                      <td className="px-3 py-2 font-medium">
                        {target.name}
                        {self && (
                          <span className="ml-1 text-xs text-muted-foreground">（自分）</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{target.email}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={target.role}
                          disabled={roleDisabled}
                          onValueChange={(v) => void changeRole(target, v as UserRole)}
                        >
                          <SelectTrigger
                            className="h-8 w-56 text-xs"
                            aria-label={`${target.name} のロール`}
                            title={
                              self
                                ? "自分自身のロールは変更できません"
                                : !editable
                                  ? notEditableReason(target)
                                  : undefined
                            }
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* 自分や上位ロールの行でも、現在値は必ず選択肢に含める */}
                            {ROLE_ORDER.filter(
                              (role) => canAssignRole(role) || role === target.role,
                            ).map((role) => (
                              <SelectItem key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {hotelName(target.hotelId)}
                      </td>
                      <td className="px-3 py-2">
                        {target.isActive ? (
                          <span className="rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-xs font-medium text-positive">
                            有効
                          </span>
                        ) : (
                          <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            無効
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {busy ? (
                          <Loader2
                            className="mx-auto h-4 w-4 animate-spin text-muted-foreground"
                            aria-hidden
                          />
                        ) : target.isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!editable || self}
                            onClick={() => setPendingDeactivate(target)}
                            title={
                              self
                                ? "自分自身を無効化することはできません"
                                : !editable
                                  ? notEditableReason(target)
                                  : undefined
                            }
                          >
                            無効化
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!editable}
                            onClick={() => void setActive(target, true)}
                          >
                            有効化
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <UserInviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roleOptions={roleOptions}
        hotels={hotels}
        // ホテル指定なし（テナント内の全ホテルを見るユーザー）を作れるのは管理者以上のみ
        allowNoHotel={isAdmin}
        defaultHotelId={hotelId}
        saving={inviting}
        onSubmit={handleInvite}
      />

      {/* 無効化の確認（F-5） */}
      <ConfirmDialog
        open={pendingDeactivate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeactivate(null)
        }}
        title="ユーザーを無効化しますか？"
        description={
          pendingDeactivate
            ? `「${pendingDeactivate.name}」はログインできなくなり、現在のセッションも切断されます。`
            : undefined
        }
        confirmLabel="無効化する"
        onConfirm={() => {
          const target = pendingDeactivate
          setPendingDeactivate(null)
          if (target) void setActive(target, false)
        }}
      />
    </Card>
  )
}
