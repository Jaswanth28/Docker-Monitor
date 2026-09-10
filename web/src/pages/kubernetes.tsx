import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Server, Boxes, AlertTriangle, Hexagon } from "lucide-react"
import { api, type K8sPod } from "@/lib/api"
import { formatBytes } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Meter } from "@/components/charts"

function phaseVariant(phase: string): "default" | "secondary" | "destructive" | "outline" | "muted" {
  switch (phase) {
    case "Running":
      return "default"
    case "Pending":
      return "secondary"
    case "Succeeded":
      return "outline"
    case "Failed":
    case "Unknown":
      return "destructive"
    default:
      return "muted"
  }
}

function fmtCores(n: number | null | undefined) {
  if (n == null) return "—"
  if (n < 0.01) return `${(n * 1000).toFixed(0)}m`
  return `${n.toFixed(2)}`
}

export default function KubernetesPage() {
  const [q, setQ] = useState("")
  const [ns, setNs] = useState<string>("")

  const status = useQuery({ queryKey: ["k8s-status"], queryFn: api.k8sStatus, refetchInterval: 15000 })
  const overview = useQuery({
    queryKey: ["k8s-overview"],
    queryFn: api.k8sOverview,
    refetchInterval: 5000,
    enabled: !!status.data?.enabled && !!status.data?.connected,
  })
  const namespaces = useQuery({
    queryKey: ["k8s-namespaces"],
    queryFn: api.k8sNamespaces,
    enabled: !!status.data?.enabled && !!status.data?.connected,
    refetchInterval: 30000,
  })

  const pods = overview.data?.pods ?? []
  const nodes = overview.data?.nodes ?? []
  const counts = overview.data?.counts

  const rows = useMemo(() => {
    const f = q.toLowerCase()
    return pods
      .filter((p: K8sPod) => !ns || p.namespace === ns)
      .filter((p: K8sPod) =>
        !f
        || p.name.toLowerCase().includes(f)
        || p.namespace.toLowerCase().includes(f)
        || (p.node ?? "").toLowerCase().includes(f)
        || p.images.some((i) => i.toLowerCase().includes(f)),
      )
      .sort((a, b) => (a.phase === "Running" ? 0 : 1) - (b.phase === "Running" ? 0 : 1) || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
  }, [pods, q, ns])

  if (status.isLoading) {
    return <div className="text-muted-foreground p-8 text-center text-sm">Checking Kubernetes…</div>
  }

  if (!status.data?.enabled) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Kubernetes</h1>
          <p className="text-muted-foreground text-sm">Optional cluster view alongside Docker</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Hexagon className="size-4" /> Not enabled</CardTitle>
            <CardDescription>Docker monitoring keeps working as usual.</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-sm">
            <p>Enable with the compose overlay (mounts your host kubeconfig):</p>
            <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">{`docker compose -f docker-compose.yml -f docker-compose.k8s.yml up -d --build`}</pre>
            <p>Needs cluster read access. CPU/memory columns need metrics-server.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!status.data.connected) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Kubernetes</h1>
          <p className="text-muted-foreground text-sm">Enabled but not connected</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="size-4" /> Connection failed</CardTitle>
            <CardDescription>{status.data.error ?? "Cannot reach the API server"}</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Check <code className="text-foreground">KUBECONFIG</code>, context, and that the API is reachable from the container network.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Kubernetes</h1>
          <p className="text-muted-foreground text-sm break-words">
            {status.data.version ?? "cluster"}
            {status.data.metrics_available ? " · metrics-server ok" : " · metrics-server missing (CPU/mem blank)"}
            {status.data.context ? ` · context ${status.data.context}` : ""}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={ns}
            onChange={(e) => setNs(e.target.value)}
          >
            <option value="">All namespaces</option>
            {(namespaces.data ?? []).map((n) => (
              <option key={n.name} value={n.name}>{n.name}</option>
            ))}
          </select>
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input placeholder="Filter pods…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        {[
          ["Pods", counts?.pods],
          ["Running", counts?.running],
          ["Namespaces", overview.data?.namespaces],
          ["Nodes ready", counts ? `${counts.nodes_ready}/${counts.nodes}` : undefined],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-card rounded-lg border p-2.5 sm:p-3">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide sm:text-xs">{l}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{v ?? "—"}</div>
          </div>
        ))}
      </div>

      {nodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Server className="size-4" /> Nodes</CardTitle>
            <CardDescription>Capacity and live usage when metrics-server is installed</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Roles</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead className="hidden lg:table-cell">Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((n) => {
                  const cpuPct = n.cpu_allocatable && n.cpu_usage != null ? (n.cpu_usage / n.cpu_allocatable) * 100 : null
                  const memPct = n.mem_allocatable && n.mem_usage != null ? (n.mem_usage / n.mem_allocatable) * 100 : null
                  return (
                    <TableRow key={n.name}>
                      <TableCell className="font-medium">{n.name}</TableCell>
                      <TableCell>
                        <Badge variant={n.ready ? "default" : "destructive"}>{n.ready ? "Ready" : "NotReady"}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell text-xs">
                        {n.roles.length ? n.roles.join(", ") : "—"}
                      </TableCell>
                      <TableCell>
                        {cpuPct != null ? (
                          <div className="flex min-w-28 flex-col gap-1">
                            <Meter value={cpuPct} thin />
                            <span className="text-muted-foreground text-[11px] tabular-nums">{fmtCores(n.cpu_usage)} / {fmtCores(n.cpu_allocatable)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">{fmtCores(n.cpu_allocatable)} alloc</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {memPct != null ? (
                          <div className="flex min-w-28 flex-col gap-1">
                            <Meter value={memPct} thin />
                            <span className="text-muted-foreground text-[11px] tabular-nums">{formatBytes(n.mem_usage ?? 0)} / {formatBytes(n.mem_allocatable)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">{formatBytes(n.mem_allocatable)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden lg:table-cell text-xs">{n.kubelet_version ?? "—"}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="py-0">
        <CardHeader className="px-4 pt-4 sm:px-6">
          <CardTitle className="flex items-center gap-2"><Boxes className="size-4" /> Pods</CardTitle>
          <CardDescription>{rows.length} shown · Docker containers stay under Containers</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead className="hidden sm:table-cell">Namespace</TableHead>
                <TableHead className="hidden md:table-cell">Node</TableHead>
                <TableHead className="hidden lg:table-cell">Ready</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead className="hidden xl:table-cell pr-4">Restarts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.isLoading && (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground p-8 text-center">Loading…</TableCell></TableRow>
              )}
              {!overview.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground p-8 text-center">No pods match</TableCell></TableRow>
              )}
              {rows.map((p) => (
                <TableRow key={p.uid}>
                  <TableCell className="pl-4 font-medium">
                    <div className="max-w-[14rem] truncate sm:max-w-xs" title={p.name}>{p.name}</div>
                    <div className="text-muted-foreground max-w-[14rem] truncate text-[11px] sm:hidden">{p.namespace}</div>
                  </TableCell>
                  <TableCell><Badge variant={phaseVariant(p.phase)}>{p.phase}</Badge></TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell text-xs">{p.namespace}</TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-xs">{p.node ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell tabular-nums text-xs">{p.ready}</TableCell>
                  <TableCell className="tabular-nums text-xs">{fmtCores(p.cpu_cores)}</TableCell>
                  <TableCell className="tabular-nums text-xs">{p.mem_bytes != null ? formatBytes(p.mem_bytes) : "—"}</TableCell>
                  <TableCell className="hidden xl:table-cell pr-4 tabular-nums text-xs">{p.restarts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
