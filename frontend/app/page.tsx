import { Suspense } from "react"
import { AuthProvider } from "@/components/auth-provider"
import { AppStateProvider } from "@/components/app-state-provider"
import { MainLayout } from "@/components/main-layout"

export default function Page() {
  return (
    // AppStateProvider は useSearchParams を使うため Suspense 境界が必要（Next.js 15）
    <Suspense fallback={null}>
      <AppStateProvider>
        <AuthProvider>
          <MainLayout />
        </AuthProvider>
      </AppStateProvider>
    </Suspense>
  )
}
