import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Play, Square, RotateCw, Trash2, ScrollText, MoreHorizontal, Search, Info, Pause, Skull, Box } from "lucide-react"
import { api, type Container, type Stats } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { formatBytes, timeAgo } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { StateBadge } from "@/components/state-badge"
import { LogsDialog } from "@/components/logs-dialog"
import { Skeleton } from "@/components/ui/skeleton"

function ContainerCardSkeleton() {
  return (
    <Card className="gap-3 overflow-hidden">
      <CardHeader className="gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
        <Skeleton className="h-3 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-3"><Skeleton className="h-8 flex-1" /><Skeleton className="h-8 flex-1" /></div>
        <div className="flex gap-1.5 border-t pt-3"><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /></div>
      </CardContent>
    </Card>
  )
}

function Meter({ value, label, sub }: { value: number; label: string; sub?: string }) {
  const color = value > 85 ? "bg-red-500" : value > 60 ? "bg-amber-500" : "bg-emerald-500"
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-baseline justify-between gap-1 text-[11px]">
        <span className="text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="font-medium tabular-nums">{sub ?? `${value.toFixed(1)}%`}</span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, value)}%` }} /></div>
    </div>
  )
}

function ContainerCard({
  c, s, isAdmin, busy, onLogs, onInspect, onRemove, onAction,
}: {
  c: Container; s?: Stats; isAdmin: boolean; busy: boolean
  onLogs: () => void; onInspect: () => void; onRemove: () => void
  onAction: (action: string) => void
}) {
  const gpuMem = s?.gpu_mem_used ?? 0
  const gpuUtil = s?.gpu_util_percent ?? 0
  const hasGpu = s && (gpuUtil > 0 || gpuMem > 0)
  const ports = c.ports.filter((p) => p.host_port)

  return (
    <Card className="gap-3 overflow-hidden">
      <CardHeader className="gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/containers/${c.id}`} className="block truncate font-medium hover:underline">{c.name}</Link>
            <div className="text-muted-foreground truncate font-mono text-xs">{c.short_id}</div>
          </div>
          <StateBadge state={c.state} health={c.health} />
        </div>
        <div className="text-muted-foreground truncate font-mono text-[11px]" title={c.image}>{c.image}</div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {c.project ? <span>{c.project} <span className="text-muted-foreground/70">/ {c.service}</span></span> : <span className="flex items-center gap-1"><Box className="size-3" /> no stack</span>}
          {c.protected && <Badge variant="outline" className="text-[10px]">dashboard</Badge>}
          <span className="ml-auto">{c.state === "running" ? timeAgo(c.started_at) : c.status}</span>
        </div>

        {ports.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ports.slice(0, 4).map((p) => (
              <a key={p.private + p.host_port} href={`http://localhost:${p.host_port}`} target="_blank" rel="noreferrer"
                className="bg-muted hover:bg-muted/70 rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors">
                {p.host_port}→{p.private}
              </a>
            ))}
            {ports.length > 4 && <span className="text-muted-foreground self-center text-[11px]">+{ports.length - 4}</span>}
          </div>
        )}

        {s ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-3">
              <Meter value={s.cpu_percent} label="cpu" />
              <Meter value={s.mem_percent} label="mem" sub={formatBytes(s.mem_usage)} />
            </div>
            {hasGpu && <Meter value={gpuUtil} label={`gpu ${(s.gpu_indexes ?? []).join(",") || ""}`} sub={gpuMem > 0 ? formatBytes(gpuMem) : `${gpuUtil.toFixed(0)}%`} />}
          </div>
        ) : (
          <div className="text-muted-foreground text-xs">Not sampled — container isn't running</div>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t pt-3">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={onLogs}><ScrollText /></Button></TooltipTrigger><TooltipContent>Logs</TooltipContent></Tooltip>
          {isAdmin && c.state !== "running" && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => onAction("start")}><Play /></Button></TooltipTrigger><TooltipContent>Start</TooltipContent></Tooltip>}
          {isAdmin && c.state === "running" && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy || c.protected} onClick={() => onAction("stop")}><Square /></Button></TooltipTrigger><TooltipContent>Stop</TooltipContent></Tooltip>}
          {isAdmin && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => onAction("restart")}><RotateCw className={busy ? "animate-spin" : ""} /></Button></TooltipTrigger><TooltipContent>Restart</TooltipContent></Tooltip>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="ml-auto"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onInspect}><Info /> Inspect</DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  {c.state === "paused"
                    ? <DropdownMenuItem onClick={() => onAction("unpause")}><Play /> Unpause</DropdownMenuItem>
                    : <DropdownMenuItem disabled={c.state !== "running" || c.protected} onClick={() => onAction("pause")}><Pause /> Pause</DropdownMenuItem>}
                  <DropdownMenuItem disabled={c.state !== "running" || c.protected} onClick={() => onAction("kill")}><Skull /> Kill</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" disabled={c.protected} onClick={onRemove}><Trash2 /> Remove</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )
}

export default function ContainersPage() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState("")
  const [logsFor, setLogsFor] = useState<Container | null>(null)
  const [inspectFor, setInspectFor] = useState<Container | null>(null)
  const [removeFor, setRemoveFor] = useState<Container | null>(null)

  const containers = useQuery({ queryKey: ["containers"], queryFn: api.containers, refetchInterval: 4000 })
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 5000 })
  const inspect = useQuery({ queryKey: ["inspect", inspectFor?.id], queryFn: () => api.inspect(inspectFor!.id), enabled: !!inspectFor })

  const statsById = useMemo(() => Object.fromEntries((stats.data ?? []).map((s) => [s.id, s])) as Record<string, Stats>, [stats.data])

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.containerAction(id, action),
    onSuccess: (_, v) => { toast.success(`${v.action} ok`); qc.invalidateQueries({ queryKey: ["containers"] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const rows = useMemo(() => {
    const list = containers.data ?? []
    const f = q.toLowerCase()
    return list
      .filter((c) => !f || c.name.toLowerCase().includes(f) || c.image.toLowerCase().includes(f) || (c.project ?? "").toLowerCase().includes(f))
      .sort((a, b) => (a.state === "running" ? 0 : 1) - (b.state === "running" ? 0 : 1) || a.name.localeCompare(b.name))
  }, [containers.data, q])

  const running = (containers.data ?? []).filter((c) => c.state === "running").length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Containers</h1>
          <p className="text-muted-foreground text-sm">{running} running · {(containers.data?.length ?? 0) - running} stopped</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input placeholder="Filter by name, image, stack…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {containers.error && <p className="text-destructive text-sm">{(containers.error as Error).message}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {containers.isLoading && Array.from({ length: 6 }).map((_, i) => <ContainerCardSkeleton key={i} />)}
        {rows.map((c) => {
          const busy = act.isPending && act.variables?.id === c.id
          return (
            <ContainerCard
              key={c.id}
              c={c}
              s={statsById[c.id]}
              isAdmin={isAdmin}
              busy={busy}
              onLogs={() => setLogsFor(c)}
              onInspect={() => setInspectFor(c)}
              onRemove={() => setRemoveFor(c)}
              onAction={(action) => act.mutate({ id: c.id, action })}
            />
          )
        })}
      </div>

      {!containers.isLoading && rows.length === 0 && (
        <Card><CardContent className="text-muted-foreground py-12 text-center">No containers match your filter.</CardContent></Card>
      )}

      <LogsDialog containerId={logsFor?.id ?? null} name={logsFor?.name} open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)} />

      <Dialog open={!!inspectFor} onOpenChange={(o) => !o && setInspectFor(null)}>
        <DialogContent className="flex h-[min(85vh,52rem)] max-h-[85vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader className="shrink-0"><DialogTitle className="font-mono">{inspectFor?.name}</DialogTitle></DialogHeader>
          {inspect.data ? (
            <pre className="bg-muted min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md p-3 font-mono text-xs">{JSON.stringify(inspect.data, null, 2)}</pre>
          ) : (
            <div className="bg-muted flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-md p-3">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${85 - (i % 4) * 12}%` }} />)}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeFor} onOpenChange={(o) => !o && setRemoveFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>The container will be force-removed. Volumes are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (removeFor) act.mutate({ id: removeFor.id, action: "remove" }); setRemoveFor(null) }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
