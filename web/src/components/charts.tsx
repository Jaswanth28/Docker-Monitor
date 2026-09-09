import { useId, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

/* Chart colours: validated single-hue blue for series, status colours for thresholds.
   Text always uses text tokens, never the series colour. */
export const SERIES = "var(--viz-series, #2a78d6)"

/** Single-series area sparkline with crosshair + tooltip. */
export function Sparkline({
  data, max, height = 56, format, className, label,
}: { data: number[]; max?: number; height?: number; format?: (v: number) => string; className?: string; label?: string }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const w = 240
  const pad = 2
  const m = max ?? Math.max(1, ...data)
  const pts = useMemo(() => {
    if (data.length < 2) return ""
    const step = (w - pad * 2) / (data.length - 1)
    return data.map((v, i) => `${(pad + i * step).toFixed(1)},${(height - pad - (Math.min(v, m) / m) * (height - pad * 2)).toFixed(1)}`).join(" ")
  }, [data, m, height])
  if (data.length < 2) return <div className={cn("text-muted-foreground flex items-center text-xs", className)} style={{ height }}>collecting…</div>
  const step = (w - pad * 2) / (data.length - 1)
  const hx = hover !== null ? pad + hover * step : null
  const fmt = format ?? ((v: number) => v.toFixed(1))
  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={label}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * w; setHover(Math.max(0, Math.min(data.length - 1, Math.round((x - pad) / step)))) }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={SERIES} stopOpacity="0.28" />
            <stop offset="100%" stopColor={SERIES} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={`${pad},${height - pad} ${pts} ${w - pad},${height - pad}`} fill={`url(#${id})`} />
        <polyline points={pts} fill="none" stroke={SERIES} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hx !== null && (
          <>
            <line x1={hx} x2={hx} y1={0} y2={height} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={hx} cy={height - pad - (Math.min(data[hover!], m) / m) * (height - pad * 2)} r="3.5" fill={SERIES} stroke="var(--background)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hover !== null && (
        <div className="bg-popover text-popover-foreground pointer-events-none absolute -top-7 rounded border px-1.5 py-0.5 font-mono text-[11px] shadow" style={{ left: `${(hx! / w) * 100}%`, transform: "translateX(-50%)" }}>
          {fmt(data[hover])}
        </div>
      )}
    </div>
  )
}

/** Horizontal bar with thin mark, rounded data-end, status colouring at thresholds. */
export function Meter({ value, max = 100, className, status = true, thin = false }: { value: number; max?: number; className?: string; status?: boolean; thin?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  const color = !status ? SERIES : pct > 90 ? "var(--viz-critical, #d03b3b)" : pct > 75 ? "var(--viz-warning, #ec835a)" : SERIES
  return (
    <div className={cn("bg-muted w-full overflow-hidden rounded-full", thin ? "h-1.5" : "h-2", className)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/** Ranked horizontal bars (one series) with direct labels; value text uses text tokens. */
export function RankedBars({ rows, format, onClick, emptyText = "nothing to show" }: {
  rows: { key: string; label: string; sub?: string; value: number }[]
  format: (v: number) => string
  onClick?: (key: string) => void
  emptyText?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="text-muted-foreground py-4 text-sm">{emptyText}</p>
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className={cn("group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1", onClick && "cursor-pointer")} onClick={() => onClick?.(r.key)} title={r.sub}>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className={cn("truncate text-sm font-medium", onClick && "group-hover:underline")}>{r.label}</span>
            {r.sub && <span className="text-muted-foreground truncate text-xs">{r.sub}</span>}
          </div>
          <span className="text-sm tabular-nums">{format(r.value)}</span>
          <div className="col-span-2 bg-muted h-2 overflow-hidden rounded-full">
            <div className="h-full rounded-r-[4px]" style={{ width: `${(r.value / max) * 100}%`, background: SERIES }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Stacked 100% bar with 2px surface gaps, legend + direct labels (<=4 segments). */
export function StackedBar({ segments, format }: { segments: { label: string; value: number; color: string }[]; format: (v: number) => string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted flex h-4 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${format(s.value)}`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="tabular-nums">{format(s.value)}</span>
            <span className="text-muted-foreground text-xs">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Stat tile: hero number + optional meter and sparkline. */
export function StatTile({ label, value, sub, meter, spark, sparkMax, sparkFormat, icon, className }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode
  meter?: { value: number; max?: number }
  spark?: number[]; sparkMax?: number; sparkFormat?: (v: number) => string
  icon?: React.ReactNode; className?: string
}) {
  return (
    <div className={cn("bg-card flex flex-col gap-2 rounded-xl border p-4", className)}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">{icon}{label}</div>
      <div className="text-2xl font-semibold tabular-nums leading-none">{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      {meter && <Meter value={meter.value} max={meter.max} />}
      {spark && <Sparkline data={spark} max={sparkMax} height={40} format={sparkFormat} label={label} />}
    </div>
  )
}
