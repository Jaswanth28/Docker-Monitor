import { Navigate, Route, Routes } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Layout } from "@/components/layout"
import LoginPage from "@/pages/login"
import ContainersPage from "@/pages/containers"
import ContainerDetailPage from "@/pages/container-detail"
import StacksPage from "@/pages/stacks"
import StackMonitorPage from "@/pages/stack-monitor"
import StackEditorPage from "@/pages/stack-editor"
import ResourcesPage from "@/pages/resources"
import SystemPage from "@/pages/system"
import { Loader2 } from "lucide-react"

export default function App() {
  const { user, loading } = useAuth()
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/containers" replace />} />
        <Route path="/containers" element={<ContainersPage />} />
        <Route path="/containers/:id" element={<ContainerDetailPage />} />
        <Route path="/stacks" element={<StacksPage />} />
        <Route path="/stacks/new" element={<StackEditorPage />} />
        <Route path="/stacks/:name" element={<StackMonitorPage />} />
        <Route path="/stacks/:name/edit" element={<StackEditorPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/system" element={<SystemPage />} />
        <Route path="*" element={<Navigate to="/containers" replace />} />
      </Route>
    </Routes>
  )
}
