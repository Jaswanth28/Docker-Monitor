import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { Boxes, Container, HardDrive, Activity, LogOut, Moon, Sun, ShieldCheck, Eye, Menu, X } from "lucide-react"
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

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  return (
    <>
      <div className="flex h-14 items-center gap-2.5 border-b px-4 font-semibold">
        <Logo size={26} /> Docker Monitor
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent", isActive && "bg-sidebar-accent font-medium")
            }
          >
            <Icon className="size-4 shrink-0" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-medium">{user?.username}</span>
          <Badge variant={user?.role === "admin" ? "default" : "muted"} className="shrink-0">
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
    </>
  )
}

export function Layout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => { setOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-56 shrink-0 flex-col border-r md:flex">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border absolute inset-y-0 left-0 flex w-[min(16rem,85vw)] flex-col border-r shadow-lg">
            <div className="absolute top-3 right-3">
              <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close"><X /></Button>
            </div>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-12 items-center gap-2 border-b px-3 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></Button>
          <div className="flex items-center gap-2 text-sm font-semibold"><Logo size={20} /> Docker Monitor</div>
        </header>
        <main className="min-w-0 flex-1 p-3 sm:p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
