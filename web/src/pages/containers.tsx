import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Play, Square, RotateCw, Trash2, ScrollText, MoreHorizontal, Search, Info, Pause, Skull } from "lucide-react"
import { api, type Container, type Stats } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { formatBytes, timeAgo } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { StateBadge } from "@/components/state-badge"
import { LogsDialog } from "@/components/logs-dialog"

function Meter({ value, label }: { value: number; label: string }) {
  const color = value > 85 ? "bg-red-500" : value > 60 ? "bg-amber-500" : "bg-emerald-500"
  return (
    <div className="w-20 sm:w-28">
      <div className="mb-0.5 flex justify-between text-[11px] text-muted-foreground"><span className="truncate">{label}</span><span className="shrink-0">{value.toFixed(1)}%</span></div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} /></div>
    </div>
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

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="hidden lg:table-cell">Image</TableHead>
                <TableHead className="hidden md:table-cell">Stack</TableHead>
                <TableHead className="hidden xl:table-cell">Ports</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead className="hidden sm:table-cell">GPU</TableHead>
                <TableHead className="hidden md:table-cell">Uptime</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {containers.isLoading && <TableRow><TableCell colSpan={10} className="text-muted-foreground p-8 text-center">Loading…</TableCell></TableRow>}
              {containers.error && <TableRow><TableCell colSpan={10} className="text-destructive p-8 text-center">{(containers.error as Error).message}</TableCell></TableRow>}
              {rows.map((c) => {
                const s = statsById[c.id]
                const busy = act.isPending && act.variables?.id === c.id
                const gpuMem = s?.gpu_mem_used ?? 0
                return (
                  <TableRow key={c.id}>
                    <TableCell className="pl-4">
                      <Link to={`/containers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      <div className="text-muted-foreground font-mono text-xs">{c.short_id}{c.protected && <Badge variant="outline" className="ml-2 text-[10px]">dashboard</Badge>}</div>
                    </TableCell>
                    <TableCell><StateBadge state={c.state} health={c.health} /></TableCell>
                    <TableCell className="hidden max-w-56 truncate font-mono text-xs lg:table-cell" title={c.image}>{c.image}</TableCell>
                    <TableCell className="hidden text-xs md:table-cell">{c.project ? <span>{c.project}<span className="text-muted-foreground"> / {c.service}</span></span> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden text-xs xl:table-cell">
                      {c.ports.filter((p) => p.host_port).slice(0, 3).map((p) => (
                        <a key={p.private + p.host_port} href={`http://localhost:${p.host_port}`} target="_blank" rel="noreferrer" className="mr-2 font-mono hover:underline">{p.host_port}→{p.private}</a>
                      ))}
                      {c.ports.filter((p) => p.host_port).length > 3 && <span className="text-muted-foreground">+{c.ports.filter((p) => p.host_port).length - 3}</span>}
                    </TableCell>
                    <TableCell>{s ? <Meter value={s.cpu_percent} label="cpu" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{s ? <Tooltip><TooltipTrigger asChild><div><Meter value={s.mem_percent} label={formatBytes(s.mem_usage)} /></div></TooltipTrigger><TooltipContent>limit {formatBytes(s.mem_limit)} · rx {formatBytes(s.net_rx)} · tx {formatBytes(s.net_tx)}</TooltipContent></Tooltip> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {s && gpuMem > 0
                        ? <Tooltip><TooltipTrigger asChild><div><Meter value={s.gpu_mem_percent ?? 0} label={formatBytes(gpuMem)} /></div></TooltipTrigger><TooltipContent>GPU {(s.gpu_indexes ?? []).join(", ") || "?"} · VRAM {formatBytes(gpuMem)}</TooltipContent></Tooltip>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="hidden text-xs md:table-cell">{c.state === "running" ? timeAgo(c.started_at) : <span className="text-muted-foreground">{c.status}</span>}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={() => setLogsFor(c)}><ScrollText /></Button></TooltipTrigger><TooltipContent>Logs</TooltipContent></Tooltip>
                        {isAdmin && c.state !== "running" && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => act.mutate({ id: c.id, action: "start" })}><Play /></Button></TooltipTrigger><TooltipContent>Start</TooltipContent></Tooltip>}
                        {isAdmin && c.state === "running" && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy || c.protected} onClick={() => act.mutate({ id: c.id, action: "stop" })}><Square /></Button></TooltipTrigger><TooltipContent>Stop</TooltipContent></Tooltip>}
                        {isAdmin && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" disabled={busy} onClick={() => act.mutate({ id: c.id, action: "restart" })}><RotateCw className={busy ? "animate-spin" : ""} /></Button></TooltipTrigger><TooltipContent>Restart</TooltipContent></Tooltip>}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setInspectFor(c)}><Info /> Inspect</DropdownMenuItem>
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="sm:hidden" disabled={busy} onClick={() => act.mutate({ id: c.id, action: "restart" })}><RotateCw /> Restart</DropdownMenuItem>
                                {c.state === "paused"
                                  ? <DropdownMenuItem onClick={() => act.mutate({ id: c.id, action: "unpause" })}><Play /> Unpause</DropdownMenuItem>
                                  : <DropdownMenuItem disabled={c.state !== "running" || c.protected} onClick={() => act.mutate({ id: c.id, action: "pause" })}><Pause /> Pause</DropdownMenuItem>}
                                <DropdownMenuItem disabled={c.state !== "running" || c.protected} onClick={() => act.mutate({ id: c.id, action: "kill" })}><Skull /> Kill</DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" disabled={c.protected} onClick={() => setRemoveFor(c)}><Trash2 /> Remove</DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!containers.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-muted-foreground p-8 text-center">No containers</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <LogsDialog containerId={logsFor?.id ?? null} name={logsFor?.name} open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)} />

      <Dialog open={!!inspectFor} onOpenChange={(o) => !o && setInspectFor(null)}>
        <DialogContent className="flex h-[85vh] flex-col sm:max-w-4xl">
          <DialogHeader><DialogTitle className="font-mono">{inspectFor?.name}</DialogTitle></DialogHeader>
          <pre className="bg-muted min-h-0 flex-1 overflow-auto rounded-md p-3 font-mono text-xs">{inspect.data ? JSON.stringify(inspect.data, null, 2) : "Loading…"}</pre>
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
