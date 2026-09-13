import { Badge } from "@/components/ui/badge"

export function UsageBadge({ inUse }: { inUse: boolean }) {
  return (
    <Badge variant={inUse ? "success" : "muted"}>
      <span className={`size-1.5 rounded-full ${inUse ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
      {inUse ? "in use" : "unused"}
    </Badge>
  )
}
