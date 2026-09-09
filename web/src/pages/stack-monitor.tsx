import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowLeft, Play, Square, RotateCw, Hammer, Download, Pencil, Cpu, MemoryStick, Network,
  ChevronDown, ScrollText, ExternalLink, Loader2, Boxes,
} from "lucide-react"
import { api, type Container } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useBackTo } from "@/hooks/use-back"
import { formatBytes, cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StateBadge } from "@/components/state-badge"
import { StatTile, Meter } from "@/components/charts"
import { LogsPanel } from "@/components/logs-dialog"

const rate = (v: number) => `${formatBytes(v)}/s`

export default function StackMonitorPage() {
  const { name } = useParams<{ name: string }>()
  const goBack = useBackTo("/stacks")
  const qc = useQueryClient()
  const { isAdmin } = useAuth()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null)

  const stacks = useQuery({ queryKey: ["stacks"], queryFn: api.stacks, refetchInterval: 5000 })
  const containers = useQuery({ queryKey: ["containers"], queryFn: api.containers, refetchInterval: 5000 })
  const metrics = useQuery({ queryKey: ["stack-metrics", name], queryFn: () => api.stackMetrics(name!), enabled: !!name, refetchInterval: 5000 })

  const stack = stacks.data?.find((s) => s.name === name)
  const members: Container[] = useMemo(
    () => (containers.data ?? []).filter((c) => c.project === name),
    [containers.data, name]
  )

  const act = useMutation({
    mutationFn: (action: string) => api.stackAction(name!, action),
    onSuccess: (r, action) => {
      toast.success(`${name}: ${action} done`)
      if (action === "rebuild") setOutput({ title: `${name} · rebuild`, text: r.output })
      qc.invalidateQueries({ queryKey: ["stacks"] })
      qc.invalidateQueries({ queryKey: ["containers"] })
      qc.invalidateQueries({ queryKey: ["stack-metrics", name] })
    },
    onError: (e: Error, action) => { toast.error(`${action} failed: ${e.message}`); setOutput({ title: `${name} · ${action} FAILED`, text: e.message }) },
  })
  const containerAct = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.containerAction(id, action),
    onSuccess: (_, v) => { toast.success(`${v.action} ok`); qc.invalidateQueries({ queryKey: ["containers"] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const cur = metrics.data?.current
  const hist = metrics.data?.history ?? []
  const busy = act.isPending

  if (stacks.isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (!stack) return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" onClick={goBack}><ArrowLeft /> Back to stacks</Button>
      <p className="text-destructive">Stack "{name}" not found.</p>
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon-sm" onClick={goBack}><ArrowLeft /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{stack.name}</h1>
              <StateBadge state={stack.state} />
              {!stack.managed && <Badge variant="outline">external</Badge>}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{stack.running}/{stack.total} containers running{stack.path && <span className="ml-2 font-mono">{stack.path}</span>}</p>
          </div>
        </div>
        {isAdmin && stack.managed && (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate("start")}><Play /> Start</Button>
            <Button size="sm" variant="outline" disabled={busy || !stack.total} onClick={() => act.mutate("down")}><Square /> Stop</Button>
            <Button size="sm" variant="outline" disabled={busy || !stack.total} onClick={() => act.mutate("restart")}><RotateCw className={busy && act.variables === "restart" ? "animate-spin" : ""} /> Restart</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate("rebuild")}>{busy && act.variables === "rebuild" ? <Loader2 className="animate-spin" /> : <Hammer />} Rebuild</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate("pull")}><Download /> Pull</Button>
            <Button size="sm" variant="ghost" asChild><Link to={`/stacks/${stack.name}/edit`}><Pencil /> Edit compose</Link></Button>
          </div>
        )}
      </div>

      {/* aggregate stats across the whole stack */}
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile icon={<Cpu className="size-3.5" />} label="Stack CPU" value={cur ? `${cur.cpu_percent.toFixed(1)}%` : "—"} sub={`summed across ${metrics.data?.containers_sampled ?? 0} sampled containers`}
          spark={hist.map((h) => h.cpu_percent)} sparkFormat={(v) => `${v.toFixed(1)}%`} />
        <StatTile icon={<MemoryStick className="size-3.5" />} label="Stack memory" value={cur ? formatBytes(cur.mem_usage) : "—"} sub="summed working set"
          spark={hist.map((h) => h.mem_usage)} sparkFormat={formatBytes} />
        <StatTile icon={<Network className="size-3.5" />} label="Stack network" value={cur ? <span className="text-lg">↓ {rate(cur.net_rx_rate)} <span className="text-muted-foreground">·</span> ↑ {rate(cur.net_tx_rate)}</span> : "—"} sub="summed rx/tx rate"
          spark={hist.map((h) => h.net_rx_rate + h.net_tx_rate)} sparkFormat={rate} />
      </div>

      {/* per-container cards */}
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium"><Boxes className="size-4" /> Containers ({members.length})</h2>
        <div className="flex flex-col gap-2">
          {members.map((c) => {
            const m = metrics.data?.per_container[c.id]
            const cc = m?.current
            const isOpen = expanded === c.id
            const cbusy = containerAct.isPending && containerAct.variables?.id === c.id
            return (
              <Card key={c.id} className="gap-0 overflow-hidden py-0">
                <button
                  className="hover:bg-muted/40 flex w-full items-center gap-4 px-4 py-3 text-left transition-colors"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  aria-expanded={isOpen}
                >
                  <ChevronDown className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-180")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <StateBadge state={c.state} health={c.health} />
                      {c.service && <span className="text-muted-foreground text-xs">{c.service}</span>}
                    </div>
                    <div className="text-muted-foreground truncate font-mono text-xs">{c.image}</div>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    <Cpu className="text-muted-foreground size-3.5" /><Meter value={cc?.cpu_percent ?? 0} thin className="w-20" /><span className="w-12 text-right text-xs tabular-nums">{cc ? `${cc.cpu_percent.toFixed(1)}%` : "—"}</span>
                  </div>
                  <div className="hidden items-center gap-2 md:flex">
                    <MemoryStick className="text-muted-foreground size-3.5" /><Meter value={cc?.mem_percent ?? 0} thin className="w-20" /><span className="w-16 text-right text-xs tabular-nums">{cc ? formatBytes(cc.mem_usage) : "—"}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t px-4 py-4">
                    <div className="mb-3 flex flex-wrap justify-end gap-1">
                      {isAdmin && (
                        <>
                          {c.state !== "running"
                            ? <Button size="sm" variant="outline" disabled={cbusy} onClick={() => containerAct.mutate({ id: c.id, action: "start" })}><Play /> Start</Button>
                            : <Button size="sm" variant="outline" disabled={cbusy || c.protected} onClick={() => containerAct.mutate({ id: c.id, action: "stop" })}><Square /> Stop</Button>}
                          <Button size="sm" variant="outline" disabled={cbusy} onClick={() => containerAct.mutate({ id: c.id, action: "restart" })}><RotateCw className={cbusy ? "animate-spin" : ""} /> Restart</Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" asChild><Link to={`/containers/${c.id}`} state={{ from: "stack", stack: name }}><ExternalLink /> Full page</Link></Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <StatTile icon={<Cpu className="size-3.5" />} label="CPU" value={cc ? `${cc.cpu_percent.toFixed(1)}%` : "—"} sub={cc ? `pids ${cc.pids}` : undefined}
                        meter={cc ? { value: cc.cpu_percent } : undefined} spark={m?.history.map((h) => h.cpu_percent)} sparkFormat={(v) => `${v.toFixed(1)}%`} />
                      <StatTile icon={<MemoryStick className="size-3.5" />} label="Memory" value={cc ? formatBytes(cc.mem_usage) : "—"} sub={cc ? `${cc.mem_percent.toFixed(1)}% of ${formatBytes(cc.mem_limit)}` : undefined}
                        meter={cc ? { value: cc.mem_percent } : undefined} spark={m?.history.map((h) => h.mem_usage)} sparkFormat={formatBytes} />
                      <StatTile icon={<Network className="size-3.5" />} label="Network" value={cc ? <span className="text-base">↓{rate(cc.net_rx_rate)} ↑{rate(cc.net_tx_rate)}</span> : "—"}
                        spark={m?.history.map((h) => h.net_rx_rate + h.net_tx_rate)} sparkFormat={rate} />
                    </div>
                    <details className="mt-4">
                      <summary className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs hover:text-foreground"><ScrollText className="size-3.5" /> Show logs</summary>
                      <div className="mt-2 h-64"><LogsPanel containerId={c.id} /></div>
                    </details>
                  </div>
                )}
              </Card>
            )
          })}
          {!members.length && <p className="text-muted-foreground text-sm">No containers for this stack are currently created. Start it to see them here.</p>}
        </div>
      </div>

      <Dialog open={!!output} onOpenChange={(o) => !o && setOutput(null)}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-3xl">
          <DialogHeader><DialogTitle className="font-mono text-sm">{output?.title}</DialogTitle></DialogHeader>
          <pre className="bg-zinc-950 text-zinc-100 min-h-0 flex-1 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{output?.text || "(no output)"}</pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
