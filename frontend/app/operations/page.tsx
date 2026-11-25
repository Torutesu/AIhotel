import { Suspense } from "react"
import { notFound } from "next/navigation"
import { AuthProvider } from "@/components/auth-provider"
import { AppStateProvider } from "@/components/app-state-provider"
import { OperationsConsole } from "@/components/operations-console"

export const dynamic = "force-dynamic"
export const metadata = { title: "運営管理 | レブスト", robots: { index: false, follow: false } }

export default function OperationsPage() {
  // Fail closed: customer deployments do not serve the console, even at a direct URL.
  if (process.env.NEXT_PUBLIC_DEMO_ADMIN_CONSOLE !== "true") notFound()
  return <Suspense fallback={null}><AppStateProvider><AuthProvider><OperationsConsole /></AuthProvider></AppStateProvider></Suspense>
}
