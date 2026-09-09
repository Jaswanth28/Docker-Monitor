import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, token, type User } from "@/lib/api"

interface AuthCtx {
  user: User | null
  loading: boolean
  isAdmin: boolean
  login: (u: string, p: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token.get()) { setLoading(false); return }
    api.me().then(setUser).catch(() => token.clear()).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const h = () => setUser(null)
    window.addEventListener("dm:logout", h)
    return () => window.removeEventListener("dm:logout", h)
  }, [])

  const login = useCallback(async (u: string, p: string) => {
    await api.login(u, p)
    setUser(await api.me())
  }, [])

  const logout = useCallback(() => { token.clear(); setUser(null) }, [])

  return <Ctx.Provider value={{ user, loading, isAdmin: user?.role === "admin", login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useAuth outside AuthProvider")
  return c
}
