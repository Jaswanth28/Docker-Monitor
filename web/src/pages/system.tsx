import { useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { RefreshCw, KeyRound, CheckCircle2, AlertTriangle, Cpu, MemoryStick, HardDrive, Container, Boxes, Layers } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { formatBytes } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RankedBars, StackedBar, StatTile, Meter } from "@/components/charts"

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

export default function SystemPage() {
  const { isAdmin } = useAuth()
  const nav = useNavigate()
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 30000 })
  const ov = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 5000 })
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000 })
  const reload = useMutation({ mutationFn: api.reloadSecrets, onSuccess: (s) => { toast.success(`Secrets reloaded from ${s.source}`); health.refetch() }, onError: (e: Error) => toast.error(e.message) })
  const refreshDf = useMutation({ mutationFn: api.refreshDf, onSuccess: () => { toast.success("Storage figures refreshed"); ov.refetch() }, onError: (e: Error) => toast.error(e.message) })

  const d = sys.data
  const o = ov.data
  const host = o?.host
  const sec = health.data?.secrets
  const df = o && "images" in o.docker_df ? o.docker_df : null
  const dockerTotal = df ? df.images.size + df.containers.size + df.volumes.size + df.build_cache.size : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">System</h1>
          <p className="text-muted-foreground text-sm">{d ? `Docker ${d.server_version} · ${d.os} · ${d.kernel} · ${d.arch}` : "…"}{o?.collector.error && <span className="text-destructive"> · collector: {o.collector.error}</span>}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { sys.refetch(); ov.refetch() }}><RefreshCw className={ov.isFetching ? "animate-spin" : ""} /> Refresh</Button>
      </div>

      {/* host */}
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile icon={<Cpu className="size-3.5" />} label="Host CPU" value={host ? `${host.cpu_percent.toFixed(1)}%` : "—"}
          sub={host ? `${d?.ncpu ?? "?"} cores · load ${host.load.map((l) => l.toFixed(2)).join(" / ")} · containers use ${o!.totals.cpu_percent.toFixed(0)}% of one core` : undefined}
          meter={host ? { value: host.cpu_percent } : undefined} spark={o?.host_history.map((h) => h.cpu_percent)} sparkMax={100} sparkFormat={(v) => `${v.toFixed(1)}%`} />
        <StatTile icon={<MemoryStick className="size-3.5" />} label="Host memory" value={host ? formatBytes(host.mem_used) : "—"}
          sub={host ? `${host.mem_percent}% of ${formatBytes(host.mem_total)} · containers hold ${formatBytes(o!.totals.mem_usage)}` : undefined}
          meter={host ? { value: host.mem_percent } : undefined} spark={o?.host_history.map((h) => h.mem_used)} sparkMax={host?.mem_total} sparkFormat={formatBytes} />
        <StatTile icon={<HardDrive className="size-3.5" />} label={o?.disk_is_host ? "Host disk (WSL root)" : "Disk (container view)"} value={o?.disk ? formatBytes(o.disk.used) : "—"}
          sub={o?.disk ? `${o.disk.percent}% of ${formatBytes(o.disk.total)} · ${formatBytes(o.disk.free)} free · docker data ${formatBytes(dockerTotal)}` : undefined}
          meter={o?.disk ? { value: o.disk.percent } : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[
          ["Running", d?.containers_running], ["Stopped", d?.containers_stopped], ["Paused", d?.containers_paused],
          ["Images", d?.images], ["Stacks", o?.stacks.filter((s) => s.name !== "(no stack)").length], ["Collector uptime", o ? fmtUptime(o.collector.uptime) : undefined],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-card rounded-lg border p-3"><div className="text-muted-foreground text-xs uppercase tracking-wide">{l}</div><div className="mt-1 text-xl font-semibold tabular-nums">{v ?? "—"}</div></div>
        ))}
      </div>

      {/* top consumers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="size-4" /> Top containers by CPU</CardTitle><CardDescription>% of one core, latest sample</CardDescription></CardHeader>
          <CardContent><RankedBars rows={(o?.top_cpu ?? []).map((e) => ({ key: e.id, label: e.name, sub: e.project ?? undefined, value: e.cpu_percent }))} format={(v) => `${v.toFixed(1)}%`} onClick={(id) => nav(`/containers/${id}`)} emptyText="No running containers sampled yet" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><MemoryStick className="size-4" /> Top containers by memory</CardTitle><CardDescription>working set (excl. page cache)</CardDescription></CardHeader>
          <CardContent><RankedBars rows={(o?.top_mem ?? []).map((e) => ({ key: e.id, label: e.name, sub: e.project ?? undefined, value: e.mem_usage }))} format={formatBytes} onClick={(id) => nav(`/containers/${id}`)} emptyText="No running containers sampled yet" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="size-4" /> Stacks by memory</CardTitle><CardDescription>summed across each compose project</CardDescription></CardHeader>
          <CardContent><RankedBars rows={(o?.stacks ?? []).map((s) => ({ key: s.name, label: s.name, sub: `${s.containers} ctr · ${s.cpu_percent.toFixed(0)}% cpu`, value: s.mem_usage }))} format={formatBytes} onClick={() => nav("/stacks")} emptyText="No stacks running" /></CardContent>
        </Card>
      </div>

      {/* docker storage */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5"><CardTitle className="flex items-center gap-2"><Layers className="size-4" /> Docker storage</CardTitle><CardDescription>{df ? `docker system df · ${formatBytes(dockerTotal)} total · cached ${Math.round((Date.now() / 1000 - df.at))}s ago` : "…"}</CardDescription></div>
            {isAdmin && <Button size="sm" variant="outline" onClick={() => refreshDf.mutate()} disabled={refreshDf.isPending}><RefreshCw className={refreshDf.isPending ? "animate-spin" : ""} /> Recalculate</Button>}
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
              <div className="text-muted-foreground flex flex-wrap gap-x-6 text-xs">
                <span>reclaimable: unused images {formatBytes(df.images.unused ?? 0)}</span>
                <span>unused volumes {formatBytes(df.volumes.unused ?? 0)}</span>
                <span>build cache {formatBytes(df.build_cache.size)}</span>
                <span className="ml-auto">→ clean up on the <button className="underline" onClick={() => nav("/resources")}>Images & Volumes</button> page</span>
              </div>
            </>
          ) : <p className="text-muted-foreground text-sm">{o && "error" in o.docker_df ? o.docker_df.error : "Calculating…"}</p>}
        </CardContent>
      </Card>

      {/* all running containers table */}
      <Card className="py-0">
        <CardHeader className="pt-6"><CardTitle className="flex items-center gap-2"><Container className="size-4" /> All running containers</CardTitle></CardHeader>
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader><TableRow><TableHead className="pl-4">Name</TableHead><TableHead>Stack</TableHead><TableHead className="w-48">CPU</TableHead><TableHead className="w-56">Memory</TableHead><TableHead>Net ↓ / ↑</TableHead><TableHead>PIDs</TableHead></TableRow></TableHeader>
            <TableBody>
              {(o?.containers ?? []).map((e) => (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => nav(`/containers/${e.id}`)}>
                  <TableCell className="pl-4 font-medium">{e.name}</TableCell>
                  <TableCell className="text-xs">{e.project ? <span>{e.project}<span className="text-muted-foreground"> / {e.service}</span></span> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><div className="flex items-center gap-2"><Meter value={e.cpu_percent} thin className="w-24" /><span className="text-xs tabular-nums">{e.cpu_percent.toFixed(1)}%</span></div></TableCell>
                  <TableCell><div className="flex items-center gap-2"><Meter value={e.mem_percent} thin className="w-24" /><span className="text-xs tabular-nums">{formatBytes(e.mem_usage)}</span></div></TableCell>
                  <TableCell className="text-xs tabular-nums">{formatBytes(e.net_rx_rate)}/s · {formatBytes(e.net_tx_rate)}/s</TableCell>
                  <TableCell className="text-xs tabular-nums">{e.pids}</TableCell>
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

      {d && (
        <Card>
          <CardHeader><CardTitle>Daemon</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 font-mono text-xs">
              <dt className="text-muted-foreground">API version</dt><dd>{d.api_version}</dd>
              <dt className="text-muted-foreground">Root dir</dt><dd>{d.docker_root}</dd>
              <dt className="text-muted-foreground">Total containers</dt><dd>{d.containers}</dd>
              <dt className="text-muted-foreground">Server time</dt><dd>{d.now}</dd>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
