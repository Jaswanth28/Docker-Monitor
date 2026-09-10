import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ArrowDownToLine, Pause, Play, Trash2 } from "lucide-react"

/** Live log stream over websocket. Reusable inline (detail page) or inside LogsDialog. */
export function LogsPanel({
  containerId,
  wsUrl,
  active = true,
  className,
}: {
  containerId?: string | null
  wsUrl?: string | null
  active?: boolean
  className?: string
}) {
  const [lines, setLines] = useState<string[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState("")
  const [follow, setFollow] = useState(true)
  const pre = useRef<HTMLPreElement>(null)
  const pausedRef = useRef(false)
  const followRef = useRef(true)
  pausedRef.current = paused
  followRef.current = follow

  useEffect(() => {
    if (!active) return
    const url = wsUrl || (containerId ? api.logsWsUrl(containerId, 300) : null)
    if (!url) return
    setLines([])
    setFollow(true)
    const ws = new WebSocket(url)
    ws.onmessage = (e) => {
      if (pausedRef.current) return
      const chunk = (e.data as string).split("\n").filter(Boolean)
      setLines((prev) => [...prev, ...chunk].slice(-5000))
    }
    ws.onerror = () => setLines((p) => [...p, "[websocket error]"])
    return () => ws.close()
  }, [active, containerId, wsUrl])

  useEffect(() => {
    if (!follow || !pre.current) return
    pre.current.scrollTop = pre.current.scrollHeight
  }, [lines, follow])

  function onScroll() {
    const el = pre.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    // User scrolled up → stop auto-follow so they can read
    if (distanceFromBottom > 48) {
      if (followRef.current) setFollow(false)
    } else if (!followRef.current) {
      setFollow(true)
    }
  }

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
        <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>{paused ? <Play /> : <Pause />} {paused ? "Resume" : "Pause"}</Button>
        <Button variant={follow ? "secondary" : "outline"} size="sm" onClick={() => setFollow((f) => !f)}><ArrowDownToLine /> Follow</Button>
        <Button variant="outline" size="sm" onClick={() => setLines([])}><Trash2 /> Clear</Button>
        <span className="text-muted-foreground self-center text-xs">{lines.length} lines</span>
      </div>
      {/* h-0 + flex-1 is required so the pane gets a bounded height and can scroll */}
      <pre
        ref={pre}
        onScroll={onScroll}
        className="bg-zinc-950 text-zinc-100 h-0 min-h-0 flex-1 overflow-y-scroll rounded-md p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap"
      >
        {shown.join("\n") || "waiting for output…"}
      </pre>
    </div>
  )
}

export function LogsDialog({ containerId, name, open, onOpenChange }: { containerId: string | null; name?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85vh,52rem)] max-h-[85vh] flex-col gap-3 overflow-hidden sm:max-w-5xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-mono text-base">{name}</DialogTitle>
          <DialogDescription>Live logs</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <LogsPanel containerId={containerId} active={open} className="min-h-0 flex-1" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
