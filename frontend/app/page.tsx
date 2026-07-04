import { AuthProvider } from "@/components/auth-provider"
import { MainLayout } from "@/components/main-layout"

export default function Page() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  )
}
