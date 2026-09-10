import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  RefreshCw, KeyRound, CheckCircle2, AlertTriangle, Cpu, MemoryStick, HardDrive,
  Container, Boxes, Layers, CircuitBoard, Power, RotateCcw,
} from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { formatBytes } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { RankedBars, StackedBar, StatTile, Meter } from "@/components/charts"

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

export default function SystemPage() {
  const { isAdmin } = useAuth()
  const nav = useNavigate()
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [manualRefresh, setManualRefresh] = useState(false)
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 30000 })
  const ov = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 5000 })
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000 })
  const reload = useMutation({ mutationFn: api.reloadSecrets, onSuccess: (s) => { toast.success(`Secrets reloaded from ${s.source}`); health.refetch() }, onError: (e: Error) => toast.error(e.message) })
  const refreshDf = useMutation({ mutationFn: api.refreshDf, onSuccess: () => { toast.success("Storage figures refreshed"); ov.refetch() }, onError: (e: Error) => toast.error(e.message) })
  const dockerCtl = useMutation({
    mutationFn: (action: "daemon-reload" | "restart-docker") => api.dockerControl(action),
    onSuccess: (r, action) => {
      if (action === "restart-docker") toast.success("Docker restart issued — reconnecting shortly…")
      else toast.success(r.output || "daemon-reload ok")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function onRefresh() {
    if (manualRefresh) return
    setManualRefresh(true)
    const started = Date.now()
    try {
      await Promise.all([sys.refetch(), ov.refetch(), health.refetch()])
      toast.success("Refreshed")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed")
    } finally {
      // Keep the spin visible long enough to notice (auto-poll also uses isFetching).
      const wait = Math.max(0, 700 - (Date.now() - started))
      if (wait) await new Promise((r) => setTimeout(r, wait))
      setManualRefresh(false)
    }
  }

  const d = sys.data
  const o = ov.data
  const host = o?.host
  const sec = health.data?.secrets
  const df = o && "images" in o.docker_df ? o.docker_df : null
  const dockerTotal = df ? df.images.size + df.containers.size + df.volumes.size + df.build_cache.size : 0
  const gpu = o?.gpu
  const gpuOk = !!gpu?.available

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">System</h1>
          <p className="text-muted-foreground text-sm break-words">{d ? `Docker ${d.server_version} · ${d.os} · ${d.kernel} · ${d.arch}` : "…"}{o?.collector.error && <span className="text-destructive"> · collector: {o.collector.error}</span>}</p>
        </div>
        <Button variant="outline" size="sm" className="w-fit shrink-0" onClick={onRefresh} disabled={manualRefresh}>
          <RefreshCw className={manualRefresh ? "animate-spin" : undefined} />
          {manualRefresh ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* host */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={<Cpu className="size-3.5" />} label="Host CPU" value={host ? `${host.cpu_percent.toFixed(1)}%` : "—"}
          sub={host ? `${d?.ncpu ?? "?"} cores · load ${host.load.map((l) => l.toFixed(2)).join(" / ")} · containers use ${o!.totals.cpu_percent.toFixed(0)}% of one core` : undefined}
          meter={host ? { value: host.cpu_percent } : undefined} spark={o?.host_history.map((h) => h.cpu_percent)} sparkMax={100} sparkFormat={(v) => `${v.toFixed(1)}%`} />
        <StatTile icon={<MemoryStick className="size-3.5" />} label="Host memory" value={host ? formatBytes(host.mem_used) : "—"}
          sub={host ? `${host.mem_percent}% of ${formatBytes(host.mem_total)} · containers hold ${formatBytes(o!.totals.mem_usage)}` : undefined}
          meter={host ? { value: host.mem_percent } : undefined} spark={o?.host_history.map((h) => h.mem_used)} sparkMax={host?.mem_total} sparkFormat={formatBytes} />
        <StatTile icon={<HardDrive className="size-3.5" />} label={o?.disk_is_host ? "Host disk" : "Disk (container view)"} value={o?.disk ? formatBytes(o.disk.used) : "—"}
          sub={o?.disk ? `${o.disk.percent}% of ${formatBytes(o.disk.total)} · ${formatBytes(o.disk.free)} free · docker data ${formatBytes(dockerTotal)}` : undefined}
          meter={o?.disk ? { value: o.disk.percent } : undefined} />
        <StatTile
          icon={<CircuitBoard className="size-3.5" />}
          label={gpuOk ? (gpu?.unified_memory || host?.gpu_unified_memory ? "GPU memory (unified)" : `GPU memory${(host?.gpu_count ?? 0) > 1 ? ` ×${host?.gpu_count}` : ""}`) : "GPU"}
          value={gpuOk && host ? formatBytes(host.gpu_mem_used ?? 0) : "—"}
          sub={gpuOk && host
            ? `${(host.gpu_mem_percent ?? 0).toFixed(0)}% of ${formatBytes(host.gpu_mem_total ?? 0)}${gpu?.unified_memory || host.gpu_unified_memory ? " host RAM" : ""} · containers ${formatBytes(o!.totals.gpu_mem_used ?? 0)}`
            : (gpu?.error ?? "No NVIDIA GPU detected")}
          meter={gpuOk && host ? { value: host.gpu_mem_percent ?? 0 } : undefined}
          spark={gpuOk ? o?.host_history.filter((h) => h.gpu_available).map((h) => h.gpu_mem_used ?? 0) : undefined}
          sparkMax={host?.gpu_mem_total}
          sparkFormat={formatBytes}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Running", d?.containers_running], ["Stopped", d?.containers_stopped], ["Paused", d?.containers_paused],
          ["Images", d?.images], ["Stacks", o?.stacks.filter((s) => s.name !== "(no stack)").length], ["Collector uptime", o ? fmtUptime(o.collector.uptime) : undefined],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-card rounded-lg border p-2.5 sm:p-3"><div className="text-muted-foreground text-[10px] uppercase tracking-wide sm:text-xs">{l}</div><div className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{v ?? "—"}</div></div>
        ))}
      </div>

      {/* GPU detail: left = compute util, right = memory by container */}
      {gpuOk && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Cpu className="size-4" /> GPU compute</CardTitle>
              <CardDescription>SM / core utilization</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {(gpu?.gpus ?? []).map((g) => (
                <div key={g.uuid} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">GPU {g.index} · {g.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {g.temperature_c != null && <>{g.temperature_c}°C</>}
                      {g.power_w != null && <>{g.temperature_c != null ? " · " : ""}{g.power_w.toFixed(0)} W</>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Meter value={g.util_percent} thin className="flex-1" />
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums">{g.util_percent.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Container className="size-4" /> GPU memory by container</CardTitle>
              <CardDescription>
                {gpu?.unified_memory
                  ? "Process-attributed use of the shared host RAM pool (UMA)"
                  : "VRAM attributed via process → cgroup mapping"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RankedBars
                rows={(gpu?.containers ?? []).map((e) => ({
                  key: e.container_id,
                  label: e.name,
                  sub: [e.project, e.gpu_indexes.length ? `GPU ${e.gpu_indexes.join(",")}` : null].filter(Boolean).join(" · ") || undefined,
                  value: e.mem_used,
                }))}
                format={formatBytes}
                onClick={(id) => nav(`/containers/${id}`)}
                emptyText="No container is using GPU memory right now"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* top consumers */}
      <div className={`grid gap-4 ${gpuOk ? "lg:grid-cols-2 xl:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="size-4" /> Top by CPU</CardTitle><CardDescription>% of one core, latest sample</CardDescription></CardHeader>
          <CardContent><RankedBars rows={(o?.top_cpu ?? []).map((e) => ({ key: e.id, label: e.name, sub: e.project ?? undefined, value: e.cpu_percent }))} format={(v) => `${v.toFixed(1)}%`} onClick={(id) => nav(`/containers/${id}`)} emptyText="No running containers sampled yet" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><MemoryStick className="size-4" /> Top by memory</CardTitle><CardDescription>working set (excl. page cache)</CardDescription></CardHeader>
          <CardContent><RankedBars rows={(o?.top_mem ?? []).map((e) => ({ key: e.id, label: e.name, sub: e.project ?? undefined, value: e.mem_usage }))} format={formatBytes} onClick={(id) => nav(`/containers/${id}`)} emptyText="No running containers sampled yet" /></CardContent>
        </Card>
        {gpuOk && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CircuitBoard className="size-4" /> Top by GPU</CardTitle><CardDescription>VRAM per container</CardDescription></CardHeader>
            <CardContent><RankedBars rows={(o?.top_gpu ?? []).map((e) => ({ key: e.id, label: e.name, sub: e.project ?? undefined, value: e.gpu_mem_used ?? 0 }))} format={formatBytes} onClick={(id) => nav(`/containers/${id}`)} emptyText="No GPU consumers" /></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="size-4" /> Stacks by memory</CardTitle><CardDescription>summed across each compose project</CardDescription></CardHeader>
          <CardContent><RankedBars rows={(o?.stacks ?? []).map((s) => ({ key: s.name, label: s.name, sub: `${s.containers} ctr · ${s.cpu_percent.toFixed(0)}% cpu${s.gpu_mem_used ? ` · GPU ${formatBytes(s.gpu_mem_used)}` : ""}`, value: s.mem_usage }))} format={formatBytes} onClick={() => nav("/stacks")} emptyText="No stacks running" /></CardContent>
        </Card>
      </div>

      {/* docker storage */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1.5"><CardTitle className="flex items-center gap-2"><Layers className="size-4" /> Docker storage</CardTitle><CardDescription>{df ? `docker system df · ${formatBytes(dockerTotal)} total · cached ${Math.round((Date.now() / 1000 - df.at))}s ago` : "…"}</CardDescription></div>
            {isAdmin && <Button size="sm" variant="outline" className="w-fit" onClick={() => refreshDf.mutate()} disabled={refreshDf.isPending}><RefreshCw className={refreshDf.isPending ? "animate-spin" : ""} /> Recalculate</Button>}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {df ? (
            <>
              <StackedBar format={formatBytes} segments={[
                { label: `Images (${df.images.count})`, value: df.images.size, color: "var(--viz-cat-1)" },
                { label: `Container layers (${df.containers.count})`, value: df.containers.size, color: "var(--viz-cat-2)" },
                { label: `Volumes (${df.volumes.count})`, value: df.volumes.size, color: "var(--viz-cat-3)" },
                { label: `Build cache (${df.build_cache.count})`, value: df.build_cache.size, color: "var(--viz-cat-4)" },
              ]} />
              <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
                <span>reclaimable: unused images {formatBytes(df.images.unused ?? 0)}</span>
                <span>unused volumes {formatBytes(df.volumes.unused ?? 0)}</span>
                <span>build cache {formatBytes(df.build_cache.size)}</span>
                <span className="sm:ml-auto">→ clean up on the <button className="underline" onClick={() => nav("/resources")}>Images & Volumes</button> page</span>
              </div>
            </>
          ) : <p className="text-muted-foreground text-sm">{o && "error" in o.docker_df ? o.docker_df.error : "Calculating…"}</p>}
        </CardContent>
      </Card>

      {/* all running containers table */}
      <Card className="py-0">
        <CardHeader className="pt-6"><CardTitle className="flex items-center gap-2"><Container className="size-4" /> All running containers</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead className="hidden sm:table-cell">Stack</TableHead>
                <TableHead className="w-36 sm:w-48">CPU</TableHead>
                <TableHead className="w-40 sm:w-56">Memory</TableHead>
                {gpuOk && <TableHead className="w-36">GPU</TableHead>}
                <TableHead className="hidden md:table-cell">Net ↓ / ↑</TableHead>
                <TableHead className="hidden lg:table-cell">PIDs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(o?.containers ?? []).map((e) => (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => nav(`/containers/${e.id}`)}>
                  <TableCell className="pl-4 font-medium">{e.name}</TableCell>
                  <TableCell className="hidden text-xs sm:table-cell">{e.project ? <span>{e.project}<span className="text-muted-foreground"> / {e.service}</span></span> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><div className="flex items-center gap-2"><Meter value={e.cpu_percent} thin className="w-16 sm:w-24" /><span className="text-xs tabular-nums">{e.cpu_percent.toFixed(1)}%</span></div></TableCell>
                  <TableCell><div className="flex items-center gap-2"><Meter value={e.mem_percent} thin className="w-16 sm:w-24" /><span className="text-xs tabular-nums">{formatBytes(e.mem_usage)}</span></div></TableCell>
                  {gpuOk && (
                    <TableCell>
                      {(e.gpu_mem_used ?? 0) > 0
                        ? <div className="flex items-center gap-2"><Meter value={e.gpu_mem_percent ?? 0} thin className="w-16 sm:w-20" /><span className="text-xs tabular-nums">{formatBytes(e.gpu_mem_used!)}</span></div>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                  )}
                  <TableCell className="hidden text-xs tabular-nums md:table-cell">{formatBytes(e.net_rx_rate)}/s · {formatBytes(e.net_tx_rate)}/s</TableCell>
                  <TableCell className="hidden text-xs tabular-nums lg:table-cell">{e.pids}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* secrets */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Secrets</CardTitle><CardDescription>Where the API loads its credentials from.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Source:</span>
            <Badge variant={sec?.source === "infisical" ? "success" : "warning"}>{sec?.source ?? "…"}</Badge>
            {sec?.infisical_configured
              ? <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> Infisical machine identity configured</span>
              : <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-4" /> Infisical not configured — using .env fallback</span>}
          </div>
          {sec?.error && <p className="text-destructive font-mono text-xs">{sec.error}</p>}
          {sec && sec.missing.length > 0 && <p className="text-destructive text-xs">Missing: {sec.missing.join(", ")}</p>}
          <div className="text-muted-foreground text-xs">Viewer account: {sec?.viewer_enabled ? "enabled" : "not configured (set VIEWER_USERNAME / VIEWER_PASSWORD_HASH)"}</div>
          {isAdmin && <Button size="sm" variant="outline" className="w-fit" onClick={() => reload.mutate()} disabled={reload.isPending}><RefreshCw className={reload.isPending ? "animate-spin" : ""} /> Reload secrets from Infisical</Button>}
        </CardContent>
      </Card>

      {/* daemon + host controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Power className="size-4" /> Docker daemon</CardTitle>
          <CardDescription>Host systemctl actions (needs pid:host + CAP_SYS_ADMIN). Restarting Docker disconnects this dashboard briefly.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {d && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">API version</dt><dd className="break-all">{d.api_version}</dd>
              <dt className="text-muted-foreground">Root dir</dt><dd className="break-all">{d.docker_root}</dd>
              <dt className="text-muted-foreground">Total containers</dt><dd>{d.containers}</dd>
              <dt className="text-muted-foreground">Server time</dt><dd className="break-all">{d.now}</dd>
            </dl>
          )}
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={dockerCtl.isPending} onClick={() => dockerCtl.mutate("daemon-reload")}>
                <RotateCcw className={dockerCtl.isPending && dockerCtl.variables === "daemon-reload" ? "animate-spin" : ""} /> Daemon reload
              </Button>
              <Button size="sm" variant="destructive" disabled={dockerCtl.isPending} onClick={() => setConfirmRestart(true)}>
                <Power /> Restart Docker
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart the Docker daemon?</AlertDialogTitle>
            <AlertDialogDescription>
              This runs <code className="font-mono">systemctl restart docker</code> on the host. All containers will briefly stop and this dashboard will disconnect until Docker is back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { dockerCtl.mutate("restart-docker"); setConfirmRestart(false) }}>Restart Docker</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
