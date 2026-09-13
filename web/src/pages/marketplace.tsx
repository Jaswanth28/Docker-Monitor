import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Search, Store, Download, Star, ShieldCheck, Loader2, AlertTriangle, Tags, Bot, LogIn, LogOut } from "lucide-react"
import { api, type MarketplaceImage } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatBytes, formatCount, timeAgo } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

function ImageCardSkeleton() {
  return (
    <Card className="gap-3 overflow-hidden">
      <CardHeader className="gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-3"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 w-12" /></div>
        <div className="border-t pt-3"><Skeleton className="h-8 w-24" /></div>
      </CardContent>
    </Card>
  )
}

function TagRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-2 border-b p-3 last:border-0">
      <div className="min-w-0 flex-1"><Skeleton className="h-4 w-28" /><Skeleton className="mt-1.5 h-3 w-40" /></div>
      <Skeleton className="h-8 w-16 shrink-0" />
    </div>
  )
}

function DockerHubAccount() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const status = useQuery({ queryKey: ["dockerhub-status"], queryFn: api.dockerHubStatus, staleTime: 30_000 })

  const login = useMutation({
    mutationFn: () => api.dockerHubLogin(username, password),
    onSuccess: (r) => {
      toast.success(`Signed in to Docker Hub as ${r.username}`)
      setOpen(false); setPassword("")
      qc.invalidateQueries({ queryKey: ["dockerhub-status"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const logout = useMutation({
    mutationFn: api.dockerHubLogout,
    onSuccess: () => { toast.success("Signed out of Docker Hub"); qc.invalidateQueries({ queryKey: ["dockerhub-status"] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!isAdmin) return null

  return (
    <>
      {status.data?.signed_in ? (
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="success" className="shrink-0 gap-1"><ShieldCheck className="size-3" /> <span className="truncate">{status.data.username}</span></Badge>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {logout.isPending ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><LogIn /> Sign in to Docker Hub</Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign in to Docker Hub</DialogTitle>
            <DialogDescription>Needed to push images. Credentials are held in memory only — never written to disk — and cleared on sign-out or restart.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); login.mutate() }}>
            <div className="grid gap-1.5">
              <Label htmlFor="dh-user">Username</Label>
              <Input id="dh-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dh-pass">Password or access token</Label>
              <Input id="dh-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              <p className="text-muted-foreground text-xs">
                A Docker Hub <a href="https://hub.docker.com/settings/security" target="_blank" rel="noreferrer" className="underline">personal access token</a> works here and is safer than your account password.
              </p>
            </div>
            {login.error && <p className="text-destructive text-sm">{(login.error as Error).message}</p>}
            <Button type="submit" disabled={login.isPending}>{login.isPending && <Loader2 className="animate-spin" />} Sign in</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function ImageCard({ img, onOpenTags, onQuickPull, pulling }: {
  img: MarketplaceImage
  onOpenTags: (img: MarketplaceImage) => void
  onQuickPull: (img: MarketplaceImage) => void
  pulling: boolean
}) {
  const { isAdmin } = useAuth()
  return (
    <Card className="gap-3 overflow-hidden">
      <CardHeader className="gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono">{img.slug}</span>
          </CardTitle>
          {img.is_official && (
            <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]"><ShieldCheck className="size-3" /> Official</Badge>
          )}
        </div>
        <CardDescription className="line-clamp-2 min-h-[2.4em] text-xs">
          {img.description || "No description provided."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1"><Download className="size-3.5" /> {formatCount(img.pulls)} pulls</span>
          <span className="flex items-center gap-1"><Star className="size-3.5" /> {formatCount(img.stars)}</span>
          {img.is_automated && <Badge variant="outline" className="gap-1 text-[10px]"><Bot className="size-3" /> automated</Badge>}
        </div>
        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          <Button size="sm" variant="outline" onClick={() => onOpenTags(img)}><Tags /> View tags</Button>
          {isAdmin && (
            <Button size="sm" variant="outline" disabled={pulling} onClick={() => onQuickPull(img)}>
              {pulling ? <Loader2 className="animate-spin" /> : <Download />} Pull latest
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function MarketplacePage() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState("")
  const debouncedQ = useDebounced(q, 400)
  const [active, setActive] = useState<MarketplaceImage | null>(null)
  const [tagQuery, setTagQuery] = useState("")
  const debouncedTagQuery = useDebounced(tagQuery, 300)

  const popular = useQuery({ queryKey: ["marketplace-popular"], queryFn: api.marketplacePopular, staleTime: 5 * 60_000 })
  const search = useQuery({
    queryKey: ["marketplace-search", debouncedQ],
    queryFn: () => api.marketplaceSearch(debouncedQ),
    enabled: debouncedQ.trim().length > 0,
    staleTime: 60_000,
  })

  const tagsQuery = useQuery({
    queryKey: ["marketplace-tags", active?.slug, debouncedTagQuery],
    queryFn: () => api.marketplaceTags(active!.namespace, active!.name, debouncedTagQuery || undefined),
    enabled: !!active,
  })

  const pull = useMutation({
    mutationFn: ({ repository, tag }: { repository: string; tag: string }) => api.pullImage(repository, tag),
    onSuccess: (r, v) => {
      toast.success(`Pulled ${v.repository}:${v.tag}`)
      qc.invalidateQueries({ queryKey: ["images"] })
      void r
    },
    onError: (e: Error, v) => toast.error(`${v.repository}:${v.tag} — ${e.message}`),
  })

  const isSearching = debouncedQ.trim().length > 0
  const results = isSearching ? search.data?.results : popular.data?.results
  const loading = isSearching ? search.isLoading : popular.isLoading
  const err = isSearching ? (search.error as Error | undefined)?.message : popular.data?.error

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl"><Store className="size-5" /> Marketplace</h1>
          <p className="text-muted-foreground text-sm">Browse Docker Hub — search images, pick a version, pull straight into this host.</p>
        </div>
        <DockerHubAccount />
      </div>

      <div className="relative w-full sm:ml-auto sm:w-72">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
        <Input placeholder="Search Docker Hub (e.g. redis, postgres, n8n)…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {err && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Couldn't reach Docker Hub: {err}. Check that this container has outbound internet access.</span>
        </div>
      )}

      <p className="text-muted-foreground text-sm">
        {isSearching ? (search.isLoading ? "Searching…" : `${search.data?.count ?? 0} results for "${debouncedQ}"`) : "Popular images"}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading && Array.from({ length: 6 }).map((_, i) => <ImageCardSkeleton key={i} />)}
        {(results ?? []).map((img) => (
          <ImageCard
            key={img.slug}
            img={img}
            onOpenTags={(i) => { setActive(i); setTagQuery("") }}
            onQuickPull={(i) => pull.mutate({ repository: i.slug, tag: "latest" })}
            pulling={pull.isPending && pull.variables?.repository === img.slug && pull.variables?.tag === "latest"}
          />
        ))}
      </div>

      {!loading && (results ?? []).length === 0 && !err && (
        <Card><CardContent className="text-muted-foreground py-12 text-center">
          {isSearching ? "No images matched that search." : "No popular images to show right now."}
        </CardContent></Card>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="flex h-[min(80vh,36rem)] max-h-[80vh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex min-w-0 items-center gap-2 font-mono text-sm">
              <span className="truncate">{active?.slug}</span>
              {active?.is_official && <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]"><ShieldCheck className="size-3" /> Official</Badge>}
            </DialogTitle>
            <DialogDescription className="line-clamp-2">{active?.description || "Pick a version to pull."}</DialogDescription>
          </DialogHeader>
          <div className="relative shrink-0">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input placeholder="Filter tags…" className="pl-8" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {tagsQuery.isLoading && Array.from({ length: 4 }).map((_, i) => <TagRowSkeleton key={i} />)}
            {tagsQuery.error && <p className="text-destructive p-4 text-sm">{(tagsQuery.error as Error).message}</p>}
            {tagsQuery.data && tagsQuery.data.results.length === 0 && (
              <p className="text-muted-foreground p-4 text-sm">No tags found.</p>
            )}
            <div className="flex flex-col gap-1">
              {tagsQuery.data?.results.map((t) => {
                const isThisPulling = pull.isPending && pull.variables?.repository === active?.slug && pull.variables?.tag === t.name
                return (
                  <div key={t.name} className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">{t.name}</div>
                      <div className="text-muted-foreground truncate text-[11px]">
                        {formatBytes(t.size)} · {t.architectures.join(", ") || "unknown arch"} · {timeAgo(t.last_updated)}
                      </div>
                    </div>
                    {isAdmin && (
                      <Button
                        size="sm" variant="outline" className="shrink-0" disabled={isThisPulling}
                        onClick={() => active && pull.mutate({ repository: active.slug, tag: t.name })}
                      >
                        {isThisPulling ? <Loader2 className="animate-spin" /> : <Download />} Pull
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
