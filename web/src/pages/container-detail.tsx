import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Cpu, MemoryStick, HardDrive, Network, Play, Square, RotateCw, Trash2, Activity, Boxes, Skull, Pause, CircuitBoard } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useBackTo } from "@/hooks/use-back"
import { formatBytes, timeAgo } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { StateBadge } from "@/components/state-badge"
import { LogsPanel } from "@/components/logs-dialog"
import { Sparkline, StatTile } from "@/components/charts"

const rate = (v: number) => `${formatBytes(v)}/s`

export default function ContainerDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { isAdmin } = useAuth()
  const goBack = useBackTo("/containers")
  const [confirmRemove, setConfirmRemove] = useState(false)

  const detail = useQuery({ queryKey: ["detail", id], queryFn: () => api.detail(id!), enabled: !!id, refetchInterval: 15000 })
  const metrics = useQuery({ queryKey: ["metrics", id], queryFn: () => api.metrics(id!), enabled: !!id, refetchInterval: 5000 })

  const act = useMutation({
    mutationFn: (action: string) => api.containerAction(id!, action),
    onSuccess: (r, action) => {
      toast.success(`${action} ok`)
      qc.invalidateQueries({ queryKey: ["containers"] })
      if (action === "remove") nav("/containers")
      else { qc.invalidateQueries({ queryKey: ["detail", id] }); qc.invalidateQueries({ queryKey: ["metrics", id] }) }
      void r
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (detail.isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (detail.error || !detail.data) return <p className="text-destructive">{(detail.error as Error)?.message ?? "Not found"}</p>

  const d = detail.data
  const s = d.summary
  const hist = metrics.data?.history ?? d.metrics.history
  const cur = metrics.data?.current ?? d.metrics.current
  const running = s.state === "running"
  const busy = act.isPending
  const memLimitText = d.limits.memory ? formatBytes(d.limits.memory) : cur ? formatBytes(cur.mem_limit) + " (host)" : "—"
  const cpuLimit = d.limits.nano_cpus ? `${(d.limits.nano_cpus / 1e9).toFixed(2)} CPUs` : "no limit"
  const uptime = running ? timeAgo(s.started_at).replace(" ago", "") : "—"

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon-sm" onClick={goBack}><ArrowLeft /></Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{s.name}</h1>
              <StateBadge state={s.state} health={s.health} />
              {s.protected && <Badge variant="outline">dashboard</Badge>}
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              {s.short_id} · {s.image}
              {s.project && <> · <Link to="/stacks" className="hover:underline"><Boxes className="mr-1 inline size-3" />{s.project}/{s.service}</Link></>}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-1">
            {!running && <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate("start")}><Play /> Start</Button>}
            {running && <Button size="sm" variant="outline" disabled={busy || s.protected} onClick={() => act.mutate("stop")}><Square /> Stop</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate("restart")}><RotateCw className={busy ? "animate-spin" : ""} /> Restart</Button>
            {s.state === "paused"
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate("unpause")}><Play /> Unpause</Button>
              : <Button size="sm" variant="outline" disabled={busy || !running || s.protected} onClick={() => act.mutate("pause")}><Pause /> Pause</Button>}
            <Button size="sm" variant="outline" disabled={busy || !running || s.protected} onClick={() => act.mutate("kill")}><Skull /> Kill</Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy || s.protected} onClick={() => setConfirmRemove(true)}><Trash2 /> Remove</Button>
          </div>
        )}
      </div>

      {/* stat tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile icon={<Cpu className="size-3.5" />} label="CPU" value={cur ? `${cur.cpu_percent.toFixed(1)}%` : "—"} sub={`limit: ${cpuLimit} · pids ${cur?.pids ?? 0}`}
          meter={cur ? { value: cur.cpu_percent, max: 100 } : undefined} spark={hist.map((h) => h.cpu_percent)} sparkFormat={(v) => `${v.toFixed(1)}%`} />
        <StatTile icon={<MemoryStick className="size-3.5" />} label="Memory" value={cur ? formatBytes(cur.mem_usage) : "—"} sub={`${cur ? cur.mem_percent.toFixed(1) : 0}% of ${memLimitText}`}
          meter={cur ? { value: cur.mem_percent, max: 100 } : undefined} spark={hist.map((h) => h.mem_usage)} sparkFormat={formatBytes} />
        <StatTile icon={<CircuitBoard className="size-3.5" />} label="GPU memory"
          value={(cur?.gpu_mem_used ?? 0) > 0 ? formatBytes(cur!.gpu_mem_used!) : "—"}
          sub={(cur?.gpu_mem_used ?? 0) > 0
            ? `${(cur?.gpu_mem_percent ?? 0).toFixed(1)}% of pool · GPU ${(cur?.gpu_indexes ?? []).join(", ") || "?"}`
            : "not using GPU (compute util is device-wide, shown on System)"}
          meter={(cur?.gpu_mem_used ?? 0) > 0 ? { value: cur!.gpu_mem_percent ?? 0, max: 100 } : undefined}
          spark={hist.map((h) => h.gpu_mem_used ?? 0)} sparkFormat={formatBytes} />
        <StatTile icon={<HardDrive className="size-3.5" />} label="Storage" value={formatBytes(d.storage.size_rw)} sub={<>writable layer · rootfs {formatBytes(d.storage.size_rootfs)}{cur ? <> · disk r {formatBytes(cur.blk_read)} / w {formatBytes(cur.blk_write)}</> : null}</>} />
        <StatTile icon={<Network className="size-3.5" />} label="Network" value={cur ? <span className="text-lg">↓ {rate(cur.net_rx_rate)} <span className="text-muted-foreground">·</span> ↑ {rate(cur.net_tx_rate)}</span> : "—"}
          sub={cur ? `total rx ${formatBytes(cur.net_rx)} · tx ${formatBytes(cur.net_tx)}` : undefined} spark={hist.map((h) => h.net_rx_rate + h.net_tx_rate)} sparkFormat={rate} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="gap-2 py-4"><CardHeader className="px-4"><CardDescription>Uptime</CardDescription><CardTitle className="text-lg">{uptime}</CardTitle></CardHeader><CardContent className="text-muted-foreground px-4 text-xs">restarts {s.restart_count} · policy {d.restart_policy || "no"} · created {timeAgo(s.created)}</CardContent></Card>
        <Card className="gap-2 py-4"><CardHeader className="px-4"><CardDescription>Ports</CardDescription><CardTitle className="text-lg">{s.ports.filter((p) => p.host_port).length || "none"} published</CardTitle></CardHeader><CardContent className="px-4 text-xs">
          {s.ports.filter((p) => p.host_port).map((p) => <a key={p.private + p.host_port} className="mr-3 font-mono hover:underline" href={`http://localhost:${p.host_port}`} target="_blank" rel="noreferrer">{p.host_ip === "0.0.0.0" || !p.host_ip ? "" : p.host_ip + ":"}{p.host_port} → {p.private}</a>)}
          {s.ports.filter((p) => !p.host_port).length > 0 && <span className="text-muted-foreground">exposed only: {s.ports.filter((p) => !p.host_port).map((p) => p.private).join(", ")}</span>}
        </CardContent></Card>
        <Card className="gap-2 py-4"><CardHeader className="px-4"><CardDescription>Health & exit</CardDescription><CardTitle className="text-lg capitalize">{s.health ?? (running ? "no healthcheck" : `exit ${String(d.state.ExitCode ?? "?")}`)}</CardTitle></CardHeader><CardContent className="text-muted-foreground px-4 text-xs">{d.state.Error ? <span className="text-destructive">{String(d.state.Error)}</span> : `platform ${d.platform ?? "linux"} · user ${d.user || "root"}`}</CardContent></Card>
      </div>

      {/* history charts */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4" /> Last {Math.round(hist.length * 5 / 60) || "<1"} min</CardTitle><CardDescription>Sampled every 5 s; hover for values.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div><div className="text-muted-foreground mb-1 text-xs">CPU %</div><Sparkline data={hist.map((h) => h.cpu_percent)} height={80} format={(v) => `${v.toFixed(1)}%`} label="CPU history" /></div>
          <div><div className="text-muted-foreground mb-1 text-xs">Memory</div><Sparkline data={hist.map((h) => h.mem_usage)} height={80} format={formatBytes} label="Memory history" /></div>
          <div><div className="text-muted-foreground mb-1 text-xs">GPU memory</div><Sparkline data={hist.map((h) => h.gpu_mem_used ?? 0)} height={80} format={formatBytes} label="GPU history" /></div>
          <div><div className="text-muted-foreground mb-1 text-xs">Network (rx+tx)</div><Sparkline data={hist.map((h) => h.net_rx_rate + h.net_tx_rate)} height={80} format={rate} label="Network history" /></div>
        </CardContent>
      </Card>

      {/* tabs */}
      <Tabs defaultValue="logs" className="min-h-[420px]">
        <TabsList>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="mounts">Mounts ({d.mounts.length})</TabsTrigger>
          <TabsTrigger value="network">Network ({d.networks.length})</TabsTrigger>
          <TabsTrigger value="env">Environment ({d.env.length})</TabsTrigger>
          <TabsTrigger value="config">Config & labels</TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="flex h-[480px] flex-col">
          <LogsPanel containerId={s.id} />
        </TabsContent>

        <TabsContent value="mounts">
          <Card className="py-0"><CardContent className="px-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Type</TableHead><TableHead>Source / volume</TableHead><TableHead>Destination</TableHead><TableHead>Mode</TableHead><TableHead>Size</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.mounts.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4"><Badge variant="secondary">{m.type}</Badge></TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs" title={m.source}>{m.source}</TableCell>
                    <TableCell className="font-mono text-xs">{m.destination}</TableCell>
                    <TableCell className="text-xs">{m.rw ? "rw" : "ro"}</TableCell>
                    <TableCell className="text-xs">{m.size != null ? formatBytes(m.size) : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
                {!d.mounts.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground p-6 text-center">No mounts</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="network">
          <Card className="py-0"><CardContent className="px-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Network</TableHead><TableHead>IP</TableHead><TableHead>Gateway</TableHead><TableHead>MAC</TableHead><TableHead>Aliases</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.networks.map((n) => (
                  <TableRow key={n.name}>
                    <TableCell className="pl-4 font-mono text-xs">{n.name}</TableCell>
                    <TableCell className="font-mono text-xs">{n.ip || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{n.gateway || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{n.mac || "—"}</TableCell>
                    <TableCell className="text-xs">{n.aliases.join(", ") || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="env">
          <Card className="py-0"><CardContent className="px-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Key</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.env.map((e) => { const i = e.indexOf("="); const k = i < 0 ? e : e.slice(0, i); const v = i < 0 ? "" : e.slice(i + 1); const secret = /pass|secret|token|key|pwd/i.test(k)
                  return <TableRow key={e}><TableCell className="pl-4 font-mono text-xs">{k}</TableCell><TableCell className="max-w-xl truncate font-mono text-xs" title={secret ? undefined : v}>{secret ? "••••••••" : v}</TableCell></TableRow> })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="config">
          <Card><CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 font-mono text-xs">
              <dt className="text-muted-foreground">image id</dt><dd className="truncate">{d.image_id}</dd>
              <dt className="text-muted-foreground">entrypoint</dt><dd>{d.entrypoint?.join(" ") || "—"}</dd>
              <dt className="text-muted-foreground">cmd</dt><dd>{d.cmd?.join(" ") || "—"}</dd>
              <dt className="text-muted-foreground">workdir</dt><dd>{d.working_dir || "/"}</dd>
              <dt className="text-muted-foreground">cpu shares</dt><dd>{d.limits.cpu_shares || "default"}</dd>
              <dt className="text-muted-foreground">memory limit</dt><dd>{d.limits.memory ? formatBytes(d.limits.memory) : "none"}</dd>
              {Object.entries(d.labels).map(([k, v]) => <><dt key={k + "k"} className="text-muted-foreground truncate">{k}</dt><dd key={k + "v"} className="truncate" title={v}>{v}</dd></>)}
            </dl>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove {s.name}?</AlertDialogTitle><AlertDialogDescription>The container will be force-removed. Volumes are kept.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { setConfirmRemove(false); act.mutate("remove") }}>Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
