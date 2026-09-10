import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Trash2, Eraser } from "lucide-react"
import { api, type Network, type Volume } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { formatBytes, timeAgo } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { UsageBadge } from "@/components/usage-badge"

export default function ResourcesPage() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const images = useQuery({ queryKey: ["images"], queryFn: api.images, refetchInterval: 10000 })
  const volumes = useQuery({ queryKey: ["volumes"], queryFn: api.volumes, refetchInterval: 10000 })
  const networks = useQuery({ queryKey: ["networks"], queryFn: api.networks, refetchInterval: 10000 })

  const [deleteVolume, setDeleteVolume] = useState<Volume | null>(null)
  const [deleteNetwork, setDeleteNetwork] = useState<Network | null>(null)

  const invalidateAll = () => { qc.invalidateQueries({ queryKey: ["images"] }); qc.invalidateQueries({ queryKey: ["volumes"] }); qc.invalidateQueries({ queryKey: ["networks"] }) }

  const rmImage = useMutation({
    mutationFn: (id: string) => api.deleteImage(id),
    onSuccess: () => { toast.success("Image removed"); qc.invalidateQueries({ queryKey: ["images"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const rmVolume = useMutation({
    mutationFn: (name: string) => api.deleteVolume(name),
    onSuccess: () => { toast.success("Volume removed"); qc.invalidateQueries({ queryKey: ["volumes"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const rmNetwork = useMutation({
    mutationFn: (id: string) => api.deleteNetwork(id),
    onSuccess: () => { toast.success("Network removed"); qc.invalidateQueries({ queryKey: ["networks"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const prune = useMutation({
    mutationFn: (what: string) => api.prune(what),
    onSuccess: (r, what) => { toast.success(`Pruned ${what} · reclaimed ${formatBytes((r.SpaceReclaimed as number) ?? 0)}`); invalidateAll() },
    onError: (e: Error) => toast.error(e.message),
  })

  const totalImg = (images.data ?? []).reduce((a, i) => a + i.size, 0)
  const unusedImages = (images.data ?? []).filter((i) => !i.in_use).length
  const unusedVolumes = (volumes.data ?? []).filter((v) => !v.in_use).length
  const unusedNetworks = (networks.data ?? []).filter((n) => !n.in_use && !n.protected).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Images, volumes & networks</h1>
        <p className="text-muted-foreground text-sm">
          {images.data?.length ?? 0} images ({unusedImages} unused) · {formatBytes(totalImg)} · {volumes.data?.length ?? 0} volumes ({unusedVolumes} unused) · {networks.data?.length ?? 0} networks ({unusedNetworks} unused)
        </p>
      </div>
      <Tabs defaultValue="images">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="images">Images</TabsTrigger>
            <TabsTrigger value="volumes">Volumes</TabsTrigger>
            <TabsTrigger value="networks">Networks</TabsTrigger>
          </TabsList>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => prune.mutate("images")}><Eraser /> Prune dangling images</Button>
              <Button variant="outline" size="sm" onClick={() => prune.mutate("containers")}><Eraser /> Prune stopped containers</Button>
              <Button variant="outline" size="sm" onClick={() => prune.mutate("volumes")}><Eraser /> Prune unused volumes</Button>
              <Button variant="outline" size="sm" onClick={() => prune.mutate("networks")}><Eraser /> Prune unused networks</Button>
            </div>
          )}
        </div>

        <TabsContent value="images">
          <Card className="py-0"><CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Tags</TableHead><TableHead>ID</TableHead><TableHead>Size</TableHead><TableHead>Created</TableHead><TableHead>Usage</TableHead>{isAdmin && <TableHead className="pr-4 text-right" />}</TableRow></TableHeader>
              <TableBody>
                {(images.data ?? []).sort((a, b) => Number(a.in_use) - Number(b.in_use) || b.size - a.size).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="pl-4 font-mono text-xs">{i.tags.length ? i.tags.join(", ") : <span className="text-muted-foreground">&lt;none&gt;</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{i.short_id.replace("sha256:", "")}</TableCell>
                    <TableCell>{formatBytes(i.size)}</TableCell>
                    <TableCell className="text-xs">{timeAgo(i.created)}</TableCell>
                    <TableCell><UsageBadge inUse={i.in_use} /></TableCell>
                    {isAdmin && (
                      <TableCell className="pr-4 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" disabled={i.in_use} onClick={() => rmImage.mutate(i.id)}><Trash2 /></Button>
                          </TooltipTrigger>
                          <TooltipContent>{i.in_use ? "In use by a container — stop/remove it first" : "Delete image"}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!images.isLoading && images.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground p-8 text-center">No images</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="volumes">
          <Card className="py-0"><CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Name</TableHead><TableHead>Driver</TableHead><TableHead>Mountpoint</TableHead><TableHead>Created</TableHead><TableHead>Usage</TableHead>{isAdmin && <TableHead className="pr-4 text-right" />}</TableRow></TableHeader>
              <TableBody>
                {(volumes.data ?? []).sort((a, b) => Number(a.in_use) - Number(b.in_use)).map((v) => (
                  <TableRow key={v.name}>
                    <TableCell className="pl-4 font-mono text-xs">{v.name}</TableCell>
                    <TableCell>{v.driver}</TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate font-mono text-xs">{v.mountpoint}</TableCell>
                    <TableCell className="text-xs">{timeAgo(v.created)}</TableCell>
                    <TableCell><UsageBadge inUse={v.in_use} /></TableCell>
                    {isAdmin && (
                      <TableCell className="pr-4 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" disabled={v.in_use} onClick={() => setDeleteVolume(v)}><Trash2 /></Button>
                          </TooltipTrigger>
                          <TooltipContent>{v.in_use ? "In use by a container — stop/remove it first" : "Delete volume"}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!volumes.isLoading && volumes.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground p-8 text-center">No volumes</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="networks">
          <Card className="py-0"><CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Name</TableHead><TableHead>ID</TableHead><TableHead>Driver</TableHead><TableHead>Scope</TableHead><TableHead>Usage</TableHead>{isAdmin && <TableHead className="pr-4 text-right" />}</TableRow></TableHeader>
              <TableBody>
                {(networks.data ?? []).sort((a, b) => Number(a.in_use) - Number(b.in_use)).map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="pl-4 font-mono text-xs">{n.name}{n.protected && <span className="text-muted-foreground ml-2 text-[10px]">(built-in)</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{n.id}</TableCell>
                    <TableCell>{n.driver}</TableCell>
                    <TableCell>{n.scope}</TableCell>
                    <TableCell><UsageBadge inUse={n.in_use} /></TableCell>
                    {isAdmin && (
                      <TableCell className="pr-4 text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" disabled={n.in_use || n.protected} onClick={() => setDeleteNetwork(n)}><Trash2 /></Button>
                          </TooltipTrigger>
                          <TooltipContent>{n.protected ? "Built-in network, can't be removed" : n.in_use ? "In use by a container — disconnect it first" : "Delete network"}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!networks.isLoading && networks.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground p-8 text-center">No networks</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteVolume} onOpenChange={(o) => !o && setDeleteVolume(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete volume {deleteVolume?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the volume's data. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (deleteVolume) rmVolume.mutate(deleteVolume.name); setDeleteVolume(null) }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteNetwork} onOpenChange={(o) => !o && setDeleteNetwork(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete network {deleteNetwork?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Containers still attached to it will be disconnected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (deleteNetwork) rmNetwork.mutate(deleteNetwork.id); setDeleteNetwork(null) }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
