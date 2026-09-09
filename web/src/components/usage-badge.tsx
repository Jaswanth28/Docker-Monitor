import { Badge } from "@/components/ui/badge"

export function UsageBadge({ inUse }: { inUse: boolean }) {
  return (
    <Badge variant={inUse ? "success" : "destructive"}>
      <span className={`size-1.5 rounded-full ${inUse ? "bg-emerald-500" : "bg-red-500"}`} />
      {inUse ? "in use" : "unused"}
    </Badge>
  )
}
