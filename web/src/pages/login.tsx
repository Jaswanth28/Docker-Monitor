import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Logo } from "@/components/logo"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"

export default function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10000 })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await login(username, password); nav("/containers") }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  const missing = health.data?.secrets.missing ?? []

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Logo size={44} className="mb-1" />
          <CardTitle className="text-xl">Docker Monitor</CardTitle>
          <CardDescription>Sign in to manage your WSL containers</CardDescription>
        </CardHeader>
        <CardContent>
          {missing.length > 0 && (
            <div className="mb-4 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Server is missing secrets: <b>{missing.join(", ")}</b>. Add them in Infisical (or .env) and restart the API.</span>
            </div>
          )}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="u">Username</Label>
              <Input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p">Password</Label>
              <Input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Sign in</Button>
          </form>
          {health.data && (
            <p className="text-muted-foreground mt-4 text-center text-xs">
              secrets: {health.data.secrets.source}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
