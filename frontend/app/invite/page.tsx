"use client"

// 招待メールのリンク先（SAAS_DECISIONS.md D-04）

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { SetPasswordForm } from "@/components/set-password-form"

function InviteContent() {
  const token = useSearchParams().get("token")
  return <SetPasswordForm mode="invitation" token={token} />
}

export default function InvitePage() {
  // useSearchParams は静的プリレンダリング時に Suspense 境界を必要とする
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <InviteContent />
    </Suspense>
  )
}
