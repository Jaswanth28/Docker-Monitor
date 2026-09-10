import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Search, Server, Boxes, AlertTriangle, Hexagon, RotateCw } from "lucide-react"
import { api, type K8sPod, type K8sWorkload } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { formatBytes } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Meter } from "@/components/charts"

function phaseVariant(phase: string): "default" | "secondary" | "destructive" | "outline" | "muted" {
  switch (phase) {
    case "Running": return "default"
    case "Pending": return "secondary"
    case "Succeeded": return "outline"
    case "Failed":
    case "Unknown": return "destructive"
    default: return "muted"
  }
}

function fmtCores(n: number | null | undefined) {
  if (n == null) return "—"
  if (n < 0.01) return `${(n * 1000).toFixed(0)}m`
  return `${n.toFixed(2)}`
}

function NsFilter({ value, onChange, namespaces }: { value: string; onChange: (v: string) => void; namespaces: { name: string }[] }) {
  return (
    <select className="border-input bg-background h-9 rounded-md border px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All namespaces</option>
      {namespaces.map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}
    </select>
  )
}

export default function KubernetesPage() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState("")
  const [ns, setNs] = useState("")
  const [tab, setTab] = useState("overview")

  const status = useQuery({ queryKey: ["k8s-status"], queryFn: api.k8sStatus, refetchInterval: 15000 })
  const connected = !!status.data?.enabled && !!status.data?.connected
  const overview = useQuery({ queryKey: ["k8s-overview"], queryFn: api.k8sOverview, refetchInterval: 5000, enabled: connected })
  const namespaces = useQuery({ queryKey: ["k8s-namespaces"], queryFn: api.k8sNamespaces, enabled: connected, refetchInterval: 30000 })
  const deployments = useQuery({ queryKey: ["k8s-deploy", ns], queryFn: () => api.k8sDeployments(ns || undefined), enabled: connected && (tab === "workloads" || tab === "overview"), refetchInterval: 8000 })
  const statefulsets = useQuery({ queryKey: ["k8s-sts", ns], queryFn: () => api.k8sStatefulSets(ns || undefined), enabled: connected && tab === "workloads", refetchInterval: 8000 })
  const daemonsets = useQuery({ queryKey: ["k8s-ds", ns], queryFn: () => api.k8sDaemonSets(ns || undefined), enabled: connected && tab === "workloads", refetchInterval: 8000 })
  const jobs = useQuery({ queryKey: ["k8s-jobs", ns], queryFn: () => api.k8sJobs(ns || undefined), enabled: connected && tab === "workloads", refetchInterval: 8000 })
  const cronjobs = useQuery({ queryKey: ["k8s-cron", ns], queryFn: () => api.k8sCronJobs(ns || undefined), enabled: connected && tab === "workloads", refetchInterval: 8000 })
  const services = useQuery({ queryKey: ["k8s-svc", ns], queryFn: () => api.k8sServices(ns || undefined), enabled: connected && tab === "network", refetchInterval: 10000 })
  const ingresses = useQuery({ queryKey: ["k8s-ing", ns], queryFn: () => api.k8sIngresses(ns || undefined), enabled: connected && tab === "network", refetchInterval: 10000 })
  const pvcs = useQuery({ queryKey: ["k8s-pvc", ns], queryFn: () => api.k8sPvcs(ns || undefined), enabled: connected && tab === "storage", refetchInterval: 10000 })
  const pvs = useQuery({ queryKey: ["k8s-pv"], queryFn: api.k8sPvs, enabled: connected && tab === "storage", refetchInterval: 15000 })
  const configmaps = useQuery({ queryKey: ["k8s-cm", ns], queryFn: () => api.k8sConfigMaps(ns || undefined), enabled: connected && tab === "config", refetchInterval: 15000 })
  const secrets = useQuery({ queryKey: ["k8s-sec", ns], queryFn: () => api.k8sSecrets(ns || undefined), enabled: connected && tab === "config", refetchInterval: 15000 })
  const events = useQuery({ queryKey: ["k8s-events", ns], queryFn: () => api.k8sEvents(ns || undefined), enabled: connected && tab === "events", refetchInterval: 8000 })

  const scale = useMutation({
    mutationFn: ({ namespace, name, replicas }: { namespace: string; name: string; replicas: number }) => api.k8sScaleDeployment(namespace, name, replicas),
    onSuccess: () => { toast.success("Scaled"); qc.invalidateQueries({ queryKey: ["k8s-deploy"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const restart = useMutation({
    mutationFn: ({ namespace, name }: { namespace: string; name: string }) => api.k8sRestartDeployment(namespace, name),
    onSuccess: () => { toast.success("Rollout restart"); qc.invalidateQueries({ queryKey: ["k8s-deploy"] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const pods = overview.data?.pods ?? []
  const nodes = overview.data?.nodes ?? []
  const counts = overview.data?.counts
  const nsList = namespaces.data ?? []

  const podRows = useMemo(() => {
    const f = q.toLowerCase()
    return pods
      .filter((p: K8sPod) => !ns || p.namespace === ns)
      .filter((p: K8sPod) => !f || p.name.toLowerCase().includes(f) || p.namespace.toLowerCase().includes(f) || (p.node ?? "").toLowerCase().includes(f))
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
            <p>Prefer a read-only ServiceAccount — see <code className="text-foreground">deploy/k8s-readonly-rbac.yaml</code>.</p>
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
            Check kubeconfig mount, <code className="text-foreground">server:</code> URL (not 127.0.0.1 from inside Docker), and <code className="text-foreground">KUBERNETES_IN_CLUSTER=false</code>.
          </CardContent>
        </Card>
      </div>
    )
  }

  function WorkloadTable({ rows, kind }: { rows: K8sWorkload[]; kind: string }) {
    return (
      <Card className="py-0">
        <CardHeader className="px-4 pt-4"><CardTitle className="text-base">{kind}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Namespace</TableHead>
                <TableHead>Ready</TableHead>
                {kind === "Deployment" && isAdmin && <TableHead className="pr-4 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground p-6 text-center">None</TableCell></TableRow>}
              {rows.map((w) => (
                <TableRow key={`${w.namespace}/${w.name}`}>
                  <TableCell className="pl-4 font-medium">{w.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{w.namespace}</TableCell>
                  <TableCell className="tabular-nums text-xs">{w.ready ?? (w.schedule ? w.schedule : "—")}</TableCell>
                  {kind === "Deployment" && isAdmin && (
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => restart.mutate({ namespace: w.namespace, name: w.name })}><RotateCw className="size-3.5" /></Button>
                        <Button size="sm" variant="outline" onClick={() => {
                          const n = window.prompt("Replicas", String(w.replicas ?? 1))
                          if (n == null) return
                          const replicas = Number(n)
                          if (Number.isNaN(replicas)) return toast.error("Invalid number")
                          scale.mutate({ namespace: w.namespace, name: w.name, replicas })
                        }}>Scale</Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Kubernetes</h1>
          <p className="text-muted-foreground text-sm break-words">
            {status.data.version ?? "cluster"}
            {status.data.metrics_available ? " · metrics-server ok" : " · metrics-server missing"}
            {" · Docker stays under Containers"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NsFilter value={ns} onChange={setNs} namespaces={nsList} />
          <div className="relative w-full sm:w-56">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input placeholder="Filter…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[
          ["Pods", counts?.pods],
          ["Running", counts?.running],
          ["Namespaces", overview.data?.namespaces],
          ["Nodes", counts ? `${counts.nodes_ready}/${counts.nodes}` : undefined],
          ["GPU pods", counts?.gpu_pods],
          ["Deployments", overview.data?.workloads?.deployments],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-card rounded-lg border p-2.5 sm:p-3">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide sm:text-xs">{l}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{v ?? "—"}</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pods">Pods</TabsTrigger>
          <TabsTrigger value="workloads">Workloads</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          {nodes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Server className="size-4" /> Nodes</CardTitle>
                <CardDescription>Includes GPU capacity from nvidia.com/gpu (and similar) when present</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0 sm:px-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>CPU</TableHead>
                      <TableHead>Memory</TableHead>
                      <TableHead className="hidden md:table-cell">GPU</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nodes.map((n) => {
                      const cpuPct = n.cpu_allocatable && n.cpu_usage != null ? (n.cpu_usage / n.cpu_allocatable) * 100 : null
                      const memPct = n.mem_allocatable && n.mem_usage != null ? (n.mem_usage / n.mem_allocatable) * 100 : null
                      return (
                        <TableRow key={n.name}>
                          <TableCell className="font-medium">{n.name}</TableCell>
                          <TableCell><Badge variant={n.ready ? "default" : "destructive"}>{n.ready ? "Ready" : "NotReady"}</Badge></TableCell>
                          <TableCell>
                            {cpuPct != null ? (
                              <div className="flex min-w-28 flex-col gap-1">
                                <Meter value={cpuPct} thin />
                                <span className="text-muted-foreground text-[11px] tabular-nums">{fmtCores(n.cpu_usage)} / {fmtCores(n.cpu_allocatable)}</span>
                              </div>
                            ) : <span className="text-muted-foreground text-xs">{fmtCores(n.cpu_allocatable)}</span>}
                          </TableCell>
                          <TableCell>
                            {memPct != null ? (
                              <div className="flex min-w-28 flex-col gap-1">
                                <Meter value={memPct} thin />
                                <span className="text-muted-foreground text-[11px] tabular-nums">{formatBytes(n.mem_usage ?? 0)} / {formatBytes(n.mem_allocatable)}</span>
                              </div>
                            ) : <span className="text-muted-foreground text-xs">{formatBytes(n.mem_allocatable)}</span>}
                          </TableCell>
                          <TableCell className="hidden md:table-cell tabular-nums text-xs">{n.gpu_allocatable ?? 0}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pods">
          <Card className="py-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="flex items-center gap-2"><Boxes className="size-4" /> Pods</CardTitle>
              <CardDescription>{podRows.length} shown · click a name for detail, logs, events</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead className="hidden sm:table-cell">Namespace</TableHead>
                    <TableHead className="hidden md:table-cell">Node</TableHead>
                    <TableHead>CPU</TableHead>
                    <TableHead>Memory</TableHead>
                    <TableHead className="hidden lg:table-cell">GPU</TableHead>
                    <TableHead className="hidden xl:table-cell pr-4">Restarts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {podRows.map((p) => (
                    <TableRow key={p.uid}>
                      <TableCell className="pl-4 font-medium">
                        <Link className="hover:underline" to={`/kubernetes/pods/${encodeURIComponent(p.namespace)}/${encodeURIComponent(p.name)}`}>{p.name}</Link>
                      </TableCell>
                      <TableCell><Badge variant={phaseVariant(p.phase)}>{p.phase}</Badge></TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell text-xs">{p.namespace}</TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell text-xs">{p.node ?? "—"}</TableCell>
                      <TableCell className="tabular-nums text-xs">{fmtCores(p.cpu_cores)}</TableCell>
                      <TableCell className="tabular-nums text-xs">{p.mem_bytes != null ? formatBytes(p.mem_bytes) : "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell tabular-nums text-xs">{p.gpu || "—"}</TableCell>
                      <TableCell className="hidden xl:table-cell pr-4 tabular-nums text-xs">{p.restarts}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workloads" className="flex flex-col gap-4">
          <WorkloadTable rows={deployments.data ?? []} kind="Deployment" />
          <WorkloadTable rows={statefulsets.data ?? []} kind="StatefulSet" />
          <WorkloadTable rows={daemonsets.data ?? []} kind="DaemonSet" />
          <WorkloadTable rows={jobs.data ?? []} kind="Job" />
          <WorkloadTable rows={cronjobs.data ?? []} kind="CronJob" />
        </TabsContent>

        <TabsContent value="network" className="flex flex-col gap-4">
          <Card className="py-0">
            <CardHeader className="px-4 pt-4"><CardTitle className="text-base">Services</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Cluster IP</TableHead>
                    <TableHead className="pr-4">Ports</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(services.data ?? []).map((s) => (
                    <TableRow key={`${s.namespace}/${s.name}`}>
                      <TableCell className="pl-4 font-medium">{s.name}</TableCell>
                      <TableCell className="text-xs">{s.namespace}</TableCell>
                      <TableCell><Badge variant="outline">{s.type}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{s.cluster_ip}</TableCell>
                      <TableCell className="pr-4 text-xs">{s.ports.map((p) => `${p.port}${p.node_port ? `:${p.node_port}` : ""}`).join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardHeader className="px-4 pt-4"><CardTitle className="text-base">Ingresses</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead className="pr-4">Hosts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ingresses.data ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground p-6 text-center">No ingresses</TableCell></TableRow>}
                  {(ingresses.data ?? []).map((i) => (
                    <TableRow key={`${i.namespace}/${i.name}`}>
                      <TableCell className="pl-4 font-medium">{i.name}</TableCell>
                      <TableCell className="text-xs">{i.namespace}</TableCell>
                      <TableCell className="pr-4 text-xs">{i.hosts.join(", ") || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="storage" className="flex flex-col gap-4">
          <Card className="py-0">
            <CardHeader className="px-4 pt-4"><CardTitle className="text-base">PersistentVolumeClaims</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead className="pr-4">StorageClass</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(pvcs.data ?? []).map((p) => (
                    <TableRow key={`${p.namespace}/${p.name}`}>
                      <TableCell className="pl-4 font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs">{p.namespace}</TableCell>
                      <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                      <TableCell className="tabular-nums text-xs">{formatBytes(p.capacity)}</TableCell>
                      <TableCell className="pr-4 text-xs">{p.storage_class ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardHeader className="px-4 pt-4"><CardTitle className="text-base">PersistentVolumes</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead className="pr-4">Claim</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(pvs.data ?? []).map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="pl-4 font-medium">{p.name}</TableCell>
                      <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                      <TableCell className="tabular-nums text-xs">{formatBytes(p.capacity)}</TableCell>
                      <TableCell className="pr-4 text-xs">{p.claim ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="flex flex-col gap-4">
          <Card className="py-0">
            <CardHeader className="px-4 pt-4"><CardTitle className="text-base">ConfigMaps</CardTitle><CardDescription>Keys only</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead className="pr-4">Keys</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(configmaps.data ?? []).filter((c) => !q || c.name.includes(q)).map((c) => (
                    <TableRow key={`${c.namespace}/${c.name}`}>
                      <TableCell className="pl-4 font-medium">{c.name}</TableCell>
                      <TableCell className="text-xs">{c.namespace}</TableCell>
                      <TableCell className="pr-4 text-xs">{c.key_count} · {c.keys.slice(0, 6).join(", ")}{c.keys.length > 6 ? "…" : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardHeader className="px-4 pt-4"><CardTitle className="text-base">Secrets</CardTitle><CardDescription>Metadata only — values never shown</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="pr-4">Keys</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(secrets.data ?? []).filter((s) => !q || s.name.includes(q)).map((s) => (
                    <TableRow key={`${s.namespace}/${s.name}`}>
                      <TableCell className="pl-4 font-medium">{s.name}</TableCell>
                      <TableCell className="text-xs">{s.namespace}</TableCell>
                      <TableCell className="text-xs">{s.type}</TableCell>
                      <TableCell className="pr-4 text-xs">{s.key_count} · {s.keys.slice(0, 6).join(", ")}{s.keys.length > 6 ? "…" : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card className="py-0">
            <CardHeader className="px-4 pt-4"><CardTitle className="text-base">Recent events</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Object</TableHead>
                    <TableHead className="pr-4">Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(events.data ?? []).map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Badge variant={e.type === "Warning" ? "destructive" : "secondary"}>{e.type}</Badge></TableCell>
                      <TableCell className="text-xs">{e.reason}</TableCell>
                      <TableCell className="text-xs">{e.involved_kind}/{e.involved_name}</TableCell>
                      <TableCell className="text-muted-foreground pr-4 max-w-md truncate text-xs">{e.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
