import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Check, Loader2, Play, Save } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"

const TEMPLATE = `services:
  app:
    image: nginx:alpine
    container_name: my-app
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./data:/usr/share/nginx/html:ro
    environment:
      - TZ=Asia/Kolkata
`

export default function StackEditorPage() {
  const { name: routeName } = useParams()
  const isNew = !routeName
  const nav = useNavigate()
  const qc = useQueryClient()
  const { isAdmin } = useAuth()

  const [name, setName] = useState(routeName ?? "")
  const [compose, setCompose] = useState(isNew ? TEMPLATE : "")
  const [env, setEnv] = useState("")
  const [dirty, setDirty] = useState(false)
  const [services, setServices] = useState<string[] | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const existing = useQuery({ queryKey: ["stack", routeName], queryFn: () => api.stack(routeName!), enabled: !isNew })
  useEffect(() => {
    if (existing.data) { setCompose(existing.data.compose); setEnv(existing.data.env); setDirty(false) }
  }, [existing.data])

  const validate = useMutation({
    mutationFn: () => api.validateStack(compose),
    onSuccess: (r) => { setServices(r.services); setValidationError(null) },
    onError: (e: Error) => { setServices(null); setValidationError(e.message) },
  })

  const save = useMutation({
    mutationFn: async (thenUp: boolean) => {
      if (isNew) await api.createStack(name, compose, env)
      else await api.updateStack(name, compose, env)
      if (thenUp) return api.stackAction(name, "up")
      return null
    },
    onSuccess: (r, thenUp) => {
      toast.success(thenUp ? "Saved and started" : "Saved")
      setDirty(false)
      qc.invalidateQueries({ queryKey: ["stacks"] })
      qc.invalidateQueries({ queryKey: ["stack", name] })
      if (isNew) nav(`/stacks/${name}`, { replace: true })
      if (r?.output) console.info(r.output)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const nameOk = /^[a-z0-9][a-z0-9_-]{0,62}$/.test(name)
  const canSave = isAdmin && nameOk && compose.trim().length > 0 && !save.isPending

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild><Link to={isNew ? "/stacks" : `/stacks/${routeName}`}><ArrowLeft /></Link></Button>
          <div>
            <h1 className="text-2xl font-semibold">{isNew ? "New stack" : name}</h1>
            <p className="text-muted-foreground text-sm">{isNew ? "Written to <stacks dir>/<name>/docker-compose.yml" : existing.data ? `${existing.data.compose_file}${dirty ? " · unsaved changes" : ""}` : ""}</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => validate.mutate()} disabled={validate.isPending}>{validate.isPending ? <Loader2 className="animate-spin" /> : <Check />} Validate</Button>
            <Button variant="outline" onClick={() => save.mutate(false)} disabled={!canSave}><Save /> Save</Button>
            <Button onClick={() => save.mutate(true)} disabled={!canSave}>{save.isPending ? <Loader2 className="animate-spin" /> : <Play />} Save & Up</Button>
          </div>
        )}
      </div>

      {isNew && (
        <div className="grid max-w-md gap-2">
          <Label htmlFor="name">Stack name</Label>
          <Input id="name" placeholder="e.g. jellyfin" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} aria-invalid={!!name && !nameOk} />
          {name && !nameOk && <p className="text-destructive text-xs">Lowercase letters, digits, - and _ only.</p>}
        </div>
      )}

      {(services || validationError) && (
        <div className={`rounded-md border p-3 text-sm ${validationError ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-emerald-500/40 bg-emerald-500/10"}`}>
          {validationError ? validationError : <span className="flex flex-wrap items-center gap-1">Valid compose · services: {services!.map((s) => <Badge key={s} variant="success">{s}</Badge>)}</span>}
        </div>
      )}

      <Tabs defaultValue="compose" className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="compose">docker-compose.yml</TabsTrigger>
          <TabsTrigger value="env">.env</TabsTrigger>
        </TabsList>
        <TabsContent value="compose" className="min-h-0">
          <Textarea
            spellCheck={false}
            readOnly={!isAdmin}
            className="h-full min-h-[60vh] resize-none font-mono text-xs leading-5"
            value={compose}
            onChange={(e) => { setCompose(e.target.value); setDirty(true); setServices(null); setValidationError(null) }}
            onKeyDown={(e) => {
              if (e.key === "Tab") { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; const v = t.value; setCompose(v.slice(0, s) + "  " + v.slice(t.selectionEnd)); requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2)) }
            }}
          />
        </TabsContent>
        <TabsContent value="env" className="min-h-0">
          <Card className="mb-3 py-3"><CardHeader className="px-4"><CardTitle className="text-sm">Optional .env</CardTitle><CardDescription>KEY=value lines placed next to the compose file; substituted as ${"{KEY}"} in the compose.</CardDescription></CardHeader></Card>
          <Textarea spellCheck={false} readOnly={!isAdmin} className="min-h-[50vh] resize-none font-mono text-xs leading-5" placeholder="PUID=1000&#10;PGID=1000" value={env} onChange={(e) => { setEnv(e.target.value); setDirty(true) }} />
        </TabsContent>
      </Tabs>
      {!isAdmin && <CardContent className="text-muted-foreground px-0 text-xs">Read-only: your account has the viewer role.</CardContent>}
    </div>
  )
}
