import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Trash2 } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { formatBytes } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LogsPanel } from "@/components/logs-dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

function fmtCores(n: number | null | undefined) {
  if (n == null) return "—"
  if (n < 0.01) return `${(n * 1000).toFixed(0)}m`
  return `${n.toFixed(2)}`
}

export default function KubernetesPodPage() {
  const { namespace = "", name = "" } = useParams()
  const ns = decodeURIComponent(namespace)
  const podName = decodeURIComponent(name)
  const { isAdmin } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [container, setContainer] = useState<string>("")

  const pod = useQuery({
    queryKey: ["k8s-pod", ns, podName],
    queryFn: () => api.k8sPod(ns, podName),
    refetchInterval: 5000,
    enabled: !!ns && !!podName,
  })
  const events = useQuery({
    queryKey: ["k8s-pod-events", ns, podName],
    queryFn: () => api.k8sPodEvents(ns, podName),
    refetchInterval: 8000,
    enabled: !!ns && !!podName,
  })

  const del = useMutation({
    mutationFn: () => api.k8sPodDelete(ns, podName),
    onSuccess: () => {
      toast.success("Pod deleted")
      qc.invalidateQueries({ queryKey: ["k8s-overview"] })
      nav("/kubernetes")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const d = pod.data
  const activeContainer = container || d?.containers[0]?.name || ""

  if (pod.isLoading) return <div className="text-muted-foreground p-8 text-center text-sm">Loading pod…</div>
  if (pod.error || !d) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit" asChild><Link to="/kubernetes"><ArrowLeft /> Back</Link></Button>
        <p className="text-destructive text-sm">{(pod.error as Error)?.message ?? "Pod not found"}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-1 -ml-2 w-fit" asChild>
            <Link to="/kubernetes"><ArrowLeft /> Kubernetes</Link>
          </Button>
          <h1 className="truncate font-mono text-xl font-semibold sm:text-2xl">{d.name}</h1>
          <p className="text-muted-foreground text-sm">
            {d.namespace} · <Badge variant="secondary">{d.phase}</Badge>
            {d.node && <> · node {d.node}</>}
            {d.pod_ip && <> · {d.pod_ip}</>}
          </p>
        </div>
        {isAdmin && (
          <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete pod
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["CPU", fmtCores(d.cpu_cores)],
          ["Memory", d.mem_bytes != null ? formatBytes(d.mem_bytes) : "—"],
          ["GPU req", d.gpu || "—"],
          ["QoS", d.qos ?? "—"],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-card rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{l}</div>
            <div className="mt-1 font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="containers">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="containers">Containers</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="meta">Meta</TabsTrigger>
        </TabsList>

        <TabsContent value="containers">
          <Card className="py-0">
            <CardContent className="overflow-x-auto px-0 pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="hidden md:table-cell">Image</TableHead>
                    <TableHead>CPU lim</TableHead>
                    <TableHead>Mem lim</TableHead>
                    <TableHead className="pr-4">Restarts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.containers.map((c) => (
                    <TableRow key={c.name} className="cursor-pointer" onClick={() => setContainer(c.name)}>
                      <TableCell className="pl-4 font-medium">{c.name}</TableCell>
                      <TableCell><Badge variant={c.state === "running" ? "default" : "secondary"}>{c.state}</Badge></TableCell>
                      <TableCell className="text-muted-foreground hidden max-w-xs truncate md:table-cell text-xs">{c.image}</TableCell>
                      <TableCell className="tabular-nums text-xs">{fmtCores(c.cpu_limit)}</TableCell>
                      <TableCell className="tabular-nums text-xs">{c.mem_limit ? formatBytes(c.mem_limit) : "—"}</TableCell>
                      <TableCell className="pr-4 tabular-nums text-xs">{c.restarts}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {d.volumes.length > 0 && (
            <Card className="mt-4">
              <CardHeader><CardTitle className="text-base">Volumes</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <ul className="space-y-1">
                  {d.volumes.map((v) => (
                    <li key={v.name}><span className="font-medium">{v.name}</span> <span className="text-muted-foreground">({v.kind}{v.detail ? `: ${v.detail}` : ""})</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="logs" className="min-h-[28rem]">
          <Card className="flex h-[28rem] flex-col">
            <CardHeader className="shrink-0 py-3">
              <CardTitle className="text-base">Live logs</CardTitle>
              <CardDescription>
                <select
                  className="border-input bg-background mt-1 h-8 rounded-md border px-2 text-sm"
                  value={activeContainer}
                  onChange={(e) => setContainer(e.target.value)}
                >
                  {d.containers.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 pb-4">
              {activeContainer && (
                <LogsPanel
                  className="h-full"
                  wsUrl={api.k8sPodLogsWsUrl(ns, podName, activeContainer, 300)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card className="py-0">
            <CardContent className="overflow-x-auto px-0 pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="pr-4">Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(events.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground p-6 text-center">No events</TableCell></TableRow>
                  )}
                  {(events.data ?? []).map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Badge variant={e.type === "Warning" ? "destructive" : "secondary"}>{e.type}</Badge></TableCell>
                      <TableCell className="text-xs">{e.reason}</TableCell>
                      <TableCell className="text-muted-foreground pr-4 text-xs">{e.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="meta" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Labels</CardTitle></CardHeader>
            <CardContent className="font-mono text-xs break-all">
              {Object.entries(d.labels).map(([k, v]) => <div key={k}>{k}={v}</div>)}
              {!Object.keys(d.labels).length && <span className="text-muted-foreground">None</span>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {d.conditions.map((c) => (
                <div key={c.type} className="flex justify-between gap-2 border-b py-1 last:border-0">
                  <span>{c.type}</span>
                  <Badge variant={c.status === "True" ? "default" : "secondary"}>{c.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pod {d.name}?</AlertDialogTitle>
            <AlertDialogDescription>Controllers may recreate it. This cannot be undone from here.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
