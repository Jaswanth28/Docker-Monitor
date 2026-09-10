import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ArrowDownToLine, Pause, Play, Trash2 } from "lucide-react"

/** Live log stream over websocket. Reusable inline (detail page) or inside LogsDialog. */
export function LogsPanel({ containerId, active = true, className }: { containerId: string | null; active?: boolean; className?: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState("")
  const [follow, setFollow] = useState(true)
  const pre = useRef<HTMLPreElement>(null)
  const pausedRef = useRef(false)
  pausedRef.current = paused

  useEffect(() => {
    if (!active || !containerId) return
    setLines([])
    const ws = new WebSocket(api.logsWsUrl(containerId, 300))
    ws.onmessage = (e) => {
      if (pausedRef.current) return
      const chunk = (e.data as string).split("\n").filter(Boolean)
      setLines((prev) => [...prev, ...chunk].slice(-5000))
    }
    ws.onerror = () => setLines((p) => [...p, "[websocket error]"])
    return () => ws.close()
  }, [active, containerId])

  useEffect(() => {
    if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [lines, follow])

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2 overflow-hidden", className)}>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
        <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>{paused ? <Play /> : <Pause />} {paused ? "Resume" : "Pause"}</Button>
        <Button variant={follow ? "secondary" : "outline"} size="sm" onClick={() => setFollow((f) => !f)}><ArrowDownToLine /> Follow</Button>
        <Button variant="outline" size="sm" onClick={() => setLines([])}><Trash2 /> Clear</Button>
        <span className="text-muted-foreground self-center text-xs">{lines.length} lines</span>
      </div>
      <pre
        ref={pre}
        className="bg-zinc-950 text-zinc-100 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap"
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
        <div className="min-h-0 flex-1 overflow-hidden">
          <LogsPanel containerId={containerId} active={open} className="h-full" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
