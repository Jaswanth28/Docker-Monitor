import { NavLink, Outlet } from "react-router-dom"
import { Boxes, Container, HardDrive, Activity, LogOut, Moon, Sun, ShieldCheck, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Logo } from "@/components/logo"
import { useAuth } from "@/hooks/use-auth"
import { useTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"

const nav = [
  { to: "/containers", label: "Containers", icon: Container },
  { to: "/stacks", label: "Stacks", icon: Boxes },
  { to: "/resources", label: "Images & Volumes", icon: HardDrive },
  { to: "/system", label: "System", icon: Activity },
]

export function Layout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-56 shrink-0 flex-col border-r">
        <div className="flex h-14 items-center gap-2.5 border-b px-4 font-semibold">
          <Logo size={26} /> Docker Monitor
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent", isActive && "bg-sidebar-accent font-medium")
              }
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="truncate font-medium">{user?.username}</span>
            <Badge variant={user?.role === "admin" ? "default" : "muted"}>
              {user?.role === "admin" ? <ShieldCheck /> : <Eye />} {user?.role}
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="flex-1" onClick={toggle}>
              {theme === "dark" ? <Sun /> : <Moon />} {theme === "dark" ? "Light" : "Dark"}
            </Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={logout}>
              <LogOut /> Logout
            </Button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
