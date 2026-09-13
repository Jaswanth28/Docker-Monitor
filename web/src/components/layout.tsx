import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { Boxes, Container, HardDrive, Activity, LogOut, Moon, Sun, ShieldCheck, Eye, Menu, X, Hexagon, Store, Users, PanelLeftClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Logo } from "@/components/logo"
import { useAuth } from "@/hooks/use-auth"
import { useTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

const baseNav = [
  { to: "/containers", label: "Containers", icon: Container },
  { to: "/stacks", label: "Stacks", icon: Boxes },
  { to: "/marketplace", label: "Marketplace", icon: Store },
  { to: "/resources", label: "Images & Volumes", icon: HardDrive },
  { to: "/kubernetes", label: "Kubernetes", icon: Hexagon },
  { to: "/system", label: "System", icon: Activity },
]

const adminNav = [
  { to: "/users", label: "Users", icon: Users },
]

const SIDEBAR_COLLAPSED_KEY = "dm.sidebar-collapsed"

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

function Sidebar({ onNavigate, collapsed = false, onToggleCollapse }: { onNavigate?: () => void; collapsed?: boolean; onToggleCollapse?: () => void }) {
  const { user, isAdmin, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const k8s = useQuery({ queryKey: ["k8s-status"], queryFn: api.k8sStatus, staleTime: 30_000, refetchInterval: 60_000 })
  const navItems = isAdmin ? [...baseNav, ...adminNav] : baseNav

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex h-14 shrink-0 items-center border-b font-semibold", collapsed ? "justify-center px-2" : "gap-2.5 px-4")}>
        {!collapsed && (
          <>
            <Logo size={26} className="shrink-0" />
            <span className="truncate">Docker Monitor</span>
          </>
        )}
        {onToggleCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={collapsed ? "size-10" : "ml-auto"}
                onClick={onToggleCollapse}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <Logo size={20} className="shrink-0" /> : <PanelLeftClose className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <nav className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain py-3", collapsed ? "items-center gap-1.5 px-2" : "gap-0.5 px-2")}>
        {navItems.map(({ to, label, icon: Icon }) => {
          const online = to === "/kubernetes" && k8s.data?.enabled && k8s.data.connected
          const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)
          const link = (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors",
                collapsed ? "size-10 justify-center" : "px-3 py-2",
                isActive
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                isActive && !collapsed && "before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={2} />
              {!collapsed && <>{label}{online && <Badge variant="success" className="ml-auto text-[10px]">on</Badge>}</>}
              {collapsed && online && <span className="bg-emerald-500 ring-sidebar absolute top-1 right-1 size-2 rounded-full ring-2" />}
            </NavLink>
          )
          if (!collapsed) return link
          return (
            <Tooltip key={to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
      <div className="bg-sidebar shrink-0 border-t p-3">
        {!collapsed ? (
          <>
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
          </>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={toggle}>{theme === "dark" ? <Sun /> : <Moon />}</Button></TooltipTrigger><TooltipContent side="right">{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={logout}><LogOut /></Button></TooltipTrigger><TooltipContent side="right">Logout ({user?.username})</TooltipContent></Tooltip>
          </div>
        )}
      </div>
    </div>
  )
}

export function Layout() {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const location = useLocation()

  useEffect(() => { setOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0") } catch { /* best effort */ }
      return next
    })
  }

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden">
      {/* Desktop sidebar — fixed to viewport so Logout stays visible */}
      <aside className={cn("bg-sidebar text-sidebar-foreground border-sidebar-border hidden h-full shrink-0 flex-col border-r transition-[width] duration-150 md:flex", collapsed ? "w-14" : "w-56")}>
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border absolute inset-y-0 left-0 flex h-full w-[min(16rem,85vw)] flex-col border-r shadow-lg">
            <div className="absolute top-3 right-3 z-10">
              <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close"><X /></Button>
            </div>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></Button>
          <div className="flex items-center gap-2 text-sm font-semibold"><Logo size={20} /> Docker Monitor</div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
