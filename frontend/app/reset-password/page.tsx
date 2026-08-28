"use client"

// パスワード再設定メールのリンク先（SAAS_DECISIONS.md D-04）

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { SetPasswordForm } from "@/components/set-password-form"

function ResetContent() {
  const token = useSearchParams().get("token")
  return <SetPasswordForm mode="reset" token={token} />
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ResetContent />
    </Suspense>
  )
}
