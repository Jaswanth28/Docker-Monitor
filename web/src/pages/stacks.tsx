import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Play, Square, RotateCw, Download, Trash2, Pencil, Hammer, Loader2, FolderOpen, MoreHorizontal } from "lucide-react"
import { api, type Stack } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { StateBadge } from "@/components/state-badge"

export default function StacksPage() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const stacks = useQuery({ queryKey: ["stacks"], queryFn: api.stacks, refetchInterval: 5000 })
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null)
  const [deleteFor, setDeleteFor] = useState<Stack | null>(null)

  const act = useMutation({
    mutationFn: ({ name, action }: { name: string; action: string }) => api.stackAction(name, action),
    onSuccess: (r, v) => { toast.success(`${v.name}: ${v.action} done`); setOutput({ title: `${v.name} · ${v.action}`, text: r.output }); qc.invalidateQueries({ queryKey: ["stacks"] }); qc.invalidateQueries({ queryKey: ["containers"] }) },
    onError: (e: Error, v) => { toast.error(`${v.name}: ${v.action} failed`); setOutput({ title: `${v.name} · ${v.action} FAILED`, text: e.message }) },
  })
  const del = useMutation({
    mutationFn: (name: string) => api.deleteStack(name),
    onSuccess: () => { toast.success("Stack deleted"); qc.invalidateQueries({ queryKey: ["stacks"] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const isBusy = (name: string) => act.isPending && act.variables?.name === name

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Stacks</h1>
          <p className="text-muted-foreground text-sm">Compose projects. Managed stacks live in your stacks folder.</p>
        </div>
        {isAdmin && <Button asChild className="w-fit"><Link to="/stacks/new"><Plus /> New stack</Link></Button>}
      </div>

      {stacks.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {stacks.error && <p className="text-destructive">{(stacks.error as Error).message}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(stacks.data ?? []).map((s) => {
          const busy = isBusy(s.name)
          return (
            <Card key={s.name} className="gap-4">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 truncate">
                      <Link to={`/stacks/${s.name}`} className="hover:underline">{s.name}</Link>
                      {!s.managed && <Badge variant="outline" className="text-[10px]">external</Badge>}
                    </CardTitle>
                    <CardDescription className="mt-1 truncate font-mono text-xs">{s.path ?? "not in stacks folder"}</CardDescription>
                  </div>
                  <StateBadge state={s.state} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="text-muted-foreground text-xs">{s.running}/{s.total} containers running · {s.services.length} services</div>
                <div className="flex flex-wrap gap-1">
                  {s.services.map((svc) => {
                    const c = s.containers.find((x) => x.service === svc)
                    return <Badge key={svc} variant={c?.state === "running" ? "success" : c ? "muted" : "outline"}>{svc}</Badge>
                  })}
                </div>
                {isAdmin && s.managed && (
                  <div className="flex flex-wrap items-center gap-1 border-t pt-3">
                    {busy && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
                    <Tooltip><TooltipTrigger asChild><Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate({ name: s.name, action: "start" })}><Play /> Start</Button></TooltipTrigger><TooltipContent>docker compose up -d</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button size="sm" variant="outline" disabled={busy || !s.total} onClick={() => act.mutate({ name: s.name, action: "down" })}><Square /> Stop</Button></TooltipTrigger><TooltipContent>docker compose down</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button size="sm" variant="outline" disabled={busy || !s.total} onClick={() => act.mutate({ name: s.name, action: "restart" })}><RotateCw /></Button></TooltipTrigger><TooltipContent>Restart</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate({ name: s.name, action: "rebuild" })}><Hammer /></Button></TooltipTrigger><TooltipContent>Rebuild images (no cache) & recreate</TooltipContent></Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => act.mutate({ name: s.name, action: "pull" })}><Download /> Pull images</DropdownMenuItem>
                        <DropdownMenuItem asChild><Link to={`/stacks/${s.name}/edit`}><Pencil /> Edit compose</Link></DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleteFor(s)}><Trash2 /> Down + delete folder</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                {!isAdmin && s.managed && <Button size="sm" variant="outline" asChild className="w-fit"><Link to={`/stacks/${s.name}/edit`}><FolderOpen /> View compose</Link></Button>}
              </CardContent>
            </Card>
          )
        })}
      </div>
      {!stacks.isLoading && stacks.data?.length === 0 && (
        <Card><CardContent className="text-muted-foreground py-12 text-center">No stacks yet. {isAdmin && <Link to="/stacks/new" className="underline">Create one</Link>}</CardContent></Card>
      )}

      <Dialog open={!!output} onOpenChange={(o) => !o && setOutput(null)}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-3xl">
          <DialogHeader><DialogTitle className="font-mono text-sm">{output?.title}</DialogTitle></DialogHeader>
          <pre className="bg-zinc-950 text-zinc-100 min-h-0 flex-1 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{output?.text || "(no output)"}</pre>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stack {deleteFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Runs <code>docker compose down</code> and deletes <code>{deleteFor?.path}</code>. Named volumes are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (deleteFor) del.mutate(deleteFor.name); setDeleteFor(null) }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
