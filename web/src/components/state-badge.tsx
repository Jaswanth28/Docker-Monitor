import { Badge } from "@/components/ui/badge"

const map: Record<string, "success" | "warning" | "destructive" | "muted" | "secondary"> = {
  running: "success",
  partial: "warning",
  paused: "warning",
  restarting: "warning",
  exited: "muted",
  stopped: "muted",
  dead: "destructive",
  created: "secondary",
  "not created": "secondary",
}

export function StateBadge({ state, health }: { state: string; health?: string | null }) {
  const variant = health === "unhealthy" ? "destructive" : (map[state] ?? "secondary")
  return (
    <Badge variant={variant} className="capitalize">
      <span className={`size-1.5 rounded-full ${variant === "success" ? "bg-emerald-500 animate-pulse" : variant === "warning" ? "bg-amber-500" : variant === "destructive" ? "bg-red-500" : "bg-zinc-400"}`} />
      {state}{health ? ` · ${health}` : ""}
    </Badge>
  )
}
