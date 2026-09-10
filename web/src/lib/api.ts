export type Role = "admin" | "viewer"
export interface User { username: string; role: Role }

export interface Port { private: string; host_ip: string | null; host_port: string | null }
export interface Container {
  id: string; short_id: string; name: string; image: string; state: string; status: string
  health: string | null; created: string; started_at: string; ports: Port[]
  project: string | null; service: string | null; protected: boolean; restart_count: number
}
export interface Stats {
  id: string; cpu_percent: number; mem_usage: number; mem_limit: number; mem_percent: number
  net_rx: number; net_tx: number; gpu_mem_used?: number; gpu_mem_percent?: number; gpu_util_percent?: number; gpu_indexes?: number[]
}
export interface StackContainer { id: string; name: string; state: string; service: string | null }
export interface Stack {
  name: string; path: string | null; compose_file: string | null; services: string[]
  running: number; total: number; containers: StackContainer[]
  state: "running" | "partial" | "stopped" | "not created"; managed: boolean
}
export interface StackDetail { name: string; compose: string; compose_file: string; env: string }
export interface Image { id: string; short_id: string; tags: string[]; size: number; created: string; in_use: boolean }
export interface Volume { name: string; driver: string; mountpoint: string; created: string; in_use: boolean }
export interface Network { id: string; name: string; driver: string; scope: string; in_use: boolean; protected: boolean }
export interface SystemInfo {
  server_version: string; api_version: string; os: string; kernel: string; arch: string; ncpu: number; mem_total: number
  containers: number; containers_running: number; containers_paused: number; containers_stopped: number; images: number; docker_root: string; now: string
}
export interface Sample {
  t: number; cpu_percent: number; mem_usage: number; mem_limit: number; mem_percent: number
  net_rx: number; net_tx: number; net_rx_rate: number; net_tx_rate: number; blk_read: number; blk_write: number; pids: number
  gpu_mem_used?: number; gpu_mem_percent?: number; gpu_util_percent?: number; gpu_indexes?: number[]
}
export interface ContainerMetrics { id: string; current: Sample | null; history: Sample[]; meta: { name: string; project: string | null; service: string | null; image: string } | null }
export interface Mount { type: string; source: string; destination: string; rw: boolean; name: string | null; size: number | null }
export interface ContainerDetail {
  summary: Container
  metrics: ContainerMetrics
  storage: { size_rw: number; size_rootfs: number; error?: string }
  mounts: Mount[]
  networks: { name: string; ip: string; gateway: string; mac: string; aliases: string[] }[]
  env: string[]; cmd: string[] | null; entrypoint: string[] | null; working_dir: string; user: string
  labels: Record<string, string>; restart_policy: string
  limits: { memory: number; nano_cpus: number; cpu_shares: number }
  state: Record<string, unknown>; platform: string; image_id: string
}
export interface HostSample {
  t: number; cpu_percent: number; mem_total: number; mem_used: number; mem_percent: number; load: number[]
  gpu_available?: boolean; gpu_util_percent?: number; gpu_mem_used?: number; gpu_mem_total?: number
  gpu_mem_percent?: number; gpu_count?: number; gpu_unified_memory?: boolean
}
export interface GpuDevice {
  index: number; uuid: string; name: string; util_percent: number
  mem_used: number; mem_total: number; mem_percent: number
  temperature_c: number | null; power_w: number | null
}
export interface GpuContainerUsage {
  container_id: string; name: string; project: string | null; service: string | null
  mem_used: number; util_percent?: number; processes: number; gpu_indexes: number[]
}
export interface GpuProcess {
  gpu_uuid: string; gpu_index: number | null; pid: number; process_name: string
  mem_used: number; util_percent?: number; container_id: string | null; container_name?: string | null; project?: string | null
}
export interface GpuSnapshot {
  available: boolean
  gpus: GpuDevice[]
  processes: GpuProcess[]
  containers: GpuContainerUsage[]
  by_container: Record<string, { container_id: string; mem_used: number; processes: number; gpu_indexes: number[] }>
  totals: { mem_used: number; mem_total: number; mem_percent: number; util_percent: number; count: number }
  unified_memory?: boolean
  host_mem_total?: number | null
  host_mem_used?: number | null
  error: string | null
}
export interface TopEntry extends Sample { id: string; name: string; project: string | null; service: string | null; image: string }
export interface StackUsage { name: string; cpu_percent: number; mem_usage: number; gpu_mem_used?: number; gpu_util_percent?: number; containers: number; net_rx_rate: number; net_tx_rate: number }
export interface DfBucket { count: number; size: number; unused?: number; rootfs?: number }
export interface StackMetrics {
  current: Sample | null
  history: Sample[]
  per_container: Record<string, ContainerMetrics>
  containers_sampled: number
  gpu_available?: boolean
  gpu_unified_memory?: boolean
  gpu_mem_total?: number
}
export interface Overview {
  host: HostSample | null
  host_history: HostSample[]
  disk: { path: string; total: number; used: number; free: number; percent: number } | null
  disk_is_host: boolean
  docker_df: { images: DfBucket; containers: DfBucket; volumes: DfBucket; build_cache: DfBucket; at: number } | { error: string }
  gpu?: GpuSnapshot
  top_cpu: TopEntry[]
  top_mem: TopEntry[]
  top_gpu?: TopEntry[]
  containers: TopEntry[]
  stacks: StackUsage[]
  totals: { containers_sampled: number; cpu_percent: number; mem_usage: number; gpu_mem_used?: number }
  collector: { interval: number; history: number; error: string | null; uptime: number }
}
export interface Health { ok: boolean; secrets: { source: string; error: string | null; missing: string[]; infisical_configured: boolean; viewer_enabled: boolean } }

const TOKEN_KEY = "dm.token"
export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const t = token.get()
  if (t) headers.Authorization = `Bearer ${t}`
  if (init.body && typeof init.body === "string") headers["Content-Type"] = "application/json"
  const res = await fetch(`/api${path}`, { ...init, headers })
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    token.clear()
    window.dispatchEvent(new Event("dm:logout"))
  }
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j) } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  login: async (username: string, password: string) => {
    const body = new URLSearchParams({ username, password })
    const res = await fetch("/api/auth/login", { method: "POST", body })
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, j.detail ?? "Login failed") }
    const j = (await res.json()) as { access_token: string }
    token.set(j.access_token)
    return j
  },
  me: () => request<User>("/auth/me"),
  health: () => request<Health>("/health"),
  reloadSecrets: () => request<Health["secrets"]>("/secrets/reload", { method: "POST" }),

  containers: () => request<Container[]>("/containers"),
  stats: () => request<Stats[]>("/containers/stats"),
  inspect: (id: string) => request<Record<string, unknown>>(`/containers/${id}`),
  detail: (id: string) => request<ContainerDetail>(`/containers/${id}/detail`),
  metrics: (id: string) => request<ContainerMetrics>(`/containers/${id}/metrics`),
  overview: () => request<Overview>("/system/overview"),
  refreshDf: () => request<Record<string, unknown>>("/system/df/refresh", { method: "POST" }),
  dockerControl: (action: "daemon-reload" | "restart-docker") =>
    request<{ ok: boolean; action: string; output: string; via: string }>(`/system/docker/${action}`, { method: "POST" }),
  logs: (id: string, tail = 300) => request<{ logs: string }>(`/containers/${id}/logs?tail=${tail}`),
  containerAction: (id: string, action: string) => request<{ ok: boolean; state: string }>(`/containers/${id}/${action}`, { method: "POST" }),
  logsWsUrl: (id: string, tail = 200) => {
    const proto = location.protocol === "https:" ? "wss" : "ws"
    return `${proto}://${location.host}/api/containers/${id}/logs/ws?tail=${tail}&token=${encodeURIComponent(token.get() ?? "")}`
  },

  stacks: () => request<Stack[]>("/stacks"),
  stack: (name: string) => request<StackDetail>(`/stacks/${name}`),
  createStack: (name: string, compose: string, env?: string) => request<{ ok: boolean }>(`/stacks/${name}`, { method: "POST", body: JSON.stringify({ compose, env }) }),
  updateStack: (name: string, compose: string, env?: string) => request<{ ok: boolean }>(`/stacks/${name}`, { method: "PUT", body: JSON.stringify({ compose, env }) }),
  deleteStack: (name: string) => request<{ ok: boolean }>(`/stacks/${name}`, { method: "DELETE" }),
  validateStack: (compose: string) => request<{ ok: boolean; services: string[] }>(`/stacks/_/validate`, { method: "POST", body: JSON.stringify({ compose }) }),
  stackAction: (name: string, action: string) => request<{ ok: boolean; output: string }>(`/stacks/${name}/${action}`, { method: "POST" }),
  stackMetrics: (name: string) => request<StackMetrics>(`/stacks/${name}/metrics`),

  images: () => request<Image[]>("/images"),
  deleteImage: (id: string, force = false) => request<{ ok: boolean }>(`/images/${encodeURIComponent(id)}?force=${force}`, { method: "DELETE" }),
  volumes: () => request<Volume[]>("/volumes"),
  deleteVolume: (name: string, force = false) => request<{ ok: boolean }>(`/volumes/${encodeURIComponent(name)}?force=${force}`, { method: "DELETE" }),
  networks: () => request<Network[]>("/networks"),
  deleteNetwork: (id: string) => request<{ ok: boolean }>(`/networks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  prune: (what: string) => request<Record<string, unknown>>(`/prune/${what}`, { method: "POST" }),
  system: () => request<SystemInfo>("/system"),
}
