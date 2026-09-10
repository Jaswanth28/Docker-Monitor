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
export interface PlatformInfo {
  kind: string
  label: string
  arch: string
  machine?: string
  docker_desktop?: boolean
  apple_silicon?: boolean
  nvidia?: boolean
  amd?: boolean
  intel?: boolean
  gpu_vendors?: string[]
  gpu_vendor?: string | null
  gpu_note?: string | null
  os?: string | null
  kernel?: string | null
  host_fs?: string
}
export interface SystemInfo {
  server_version: string; api_version: string; os: string; kernel: string; arch: string; ncpu: number; mem_total: number
  containers: number; containers_running: number; containers_paused: number; containers_stopped: number; images: number; docker_root: string; now: string
  platform?: PlatformInfo | null
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
  vendor?: string; unified_memory?: boolean; driver?: string
}
export interface GpuContainerUsage {
  container_id: string; name: string; project: string | null; service: string | null
  mem_used: number; util_percent?: number; processes: number; gpu_indexes: number[]
}
export interface GpuProcess {
  gpu_uuid: string; gpu_index: number | null; pid: number; process_name: string
  mem_used: number; util_percent?: number; container_id: string | null; container_name?: string | null; project?: string | null
  vendor?: string
}
export interface GpuSnapshot {
  available: boolean
  gpus: GpuDevice[]
  processes: GpuProcess[]
  containers: GpuContainerUsage[]
  by_container: Record<string, { container_id: string; mem_used: number; processes: number; gpu_indexes: number[] }>
  totals: { mem_used: number; mem_total: number; mem_percent: number; util_percent: number; count: number }
  vendors?: string[]
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
  platform?: PlatformInfo
  kubernetes?: K8sStatus
  top_cpu: TopEntry[]
  top_mem: TopEntry[]
  top_gpu?: TopEntry[]
  containers: TopEntry[]
  stacks: StackUsage[]
  totals: { containers_sampled: number; cpu_percent: number; mem_usage: number; gpu_mem_used?: number }
  collector: { interval: number; history: number; error: string | null; uptime: number }
}
export interface Health { ok: boolean; secrets: { source: string; error: string | null; missing: string[]; infisical_configured: boolean; viewer_enabled: boolean } }

export interface K8sStatus {
  enabled: boolean
  connected: boolean
  metrics_available: boolean
  error: string | null
  version?: string | null
  platform?: string | null
  in_cluster?: boolean
  kubeconfig?: string | null
  context?: string | null
}
export interface K8sNamespace { name: string; status: string; labels: Record<string, string>; created?: string | null }
export interface K8sNode {
  name: string; ready: boolean; roles: string[]
  cpu_capacity: number; mem_capacity: number
  cpu_allocatable: number; mem_allocatable: number
  gpu_capacity?: number; gpu_allocatable?: number
  cpu_usage?: number | null; mem_usage?: number | null
  kubelet_version?: string | null; os_image?: string | null; architecture?: string | null
}
export interface K8sPod {
  name: string; namespace: string; uid: string; phase: string
  node: string | null; ready: string; restarts: number; images: string[]
  cpu_cores?: number | null; mem_bytes?: number | null
  gpu?: number; qos?: string | null; created?: string | null
  owners?: { kind: string; name: string; controller?: boolean }[]
}
export interface K8sPodDetail extends K8sPod {
  labels: Record<string, string>
  annotations: Record<string, string>
  containers: {
    name: string; image: string; state: string; state_detail?: string | null
    ready: boolean; restarts: number
    cpu_request: number; cpu_limit: number; mem_request: number; mem_limit: number; gpu: number
  }[]
  volumes: { name: string; kind: string; detail?: string | null }[]
  conditions: { type: string; status: string; reason?: string | null; message?: string | null; last_transition?: string | null }[]
  resources?: { cpu_request: number; cpu_limit: number; mem_request: number; mem_limit: number; gpu: number }
  pod_ip?: string | null; host_ip?: string | null
  service_account?: string | null; restart_policy?: string | null
}
export interface K8sEvent {
  type?: string | null; reason?: string | null; message?: string | null; count: number
  first_timestamp?: string | null; last_timestamp?: string | null
  involved_kind?: string | null; involved_name?: string | null; involved_namespace?: string | null
  source?: string | null
}
export interface K8sWorkload {
  kind: string; name: string; namespace: string; ready?: string
  replicas?: number; ready_replicas?: number; available_replicas?: number; updated_replicas?: number
  desired?: number; strategy?: string | null; schedule?: string | null; suspend?: boolean
  completions?: number | null; succeeded?: number; failed?: number; active?: number
  last_schedule?: string | null; created?: string | null; images?: string[]
}
export interface K8sService {
  name: string; namespace: string; type?: string | null; cluster_ip?: string | null
  external_ips?: string[]; ports: { port: number; target_port: string; protocol?: string; node_port?: number | null; name?: string | null }[]
  selector: Record<string, string>; created?: string | null
}
export interface K8sIngress { name: string; namespace: string; hosts: string[]; class_name?: string | null; created?: string | null }
export interface K8sPvc {
  name: string; namespace: string; status?: string | null; volume?: string | null
  storage_class?: string | null; capacity: number; access_modes: string[]; created?: string | null
}
export interface K8sPv {
  name: string; status?: string | null; capacity: number; storage_class?: string | null
  reclaim_policy?: string | null; claim?: string | null; access_modes: string[]; created?: string | null
}
export interface K8sConfigMap { name: string; namespace: string; keys: string[]; key_count: number; created?: string | null }
export interface K8sSecretMeta { name: string; namespace: string; type?: string | null; keys: string[]; key_count: number; created?: string | null }
export interface K8sOverview {
  status: K8sStatus
  namespaces: number
  nodes: K8sNode[]
  pods: K8sPod[]
  counts: {
    pods?: number; running?: number; pending?: number; failed?: number
    nodes?: number; nodes_ready?: number; gpu_pods?: number; gpu_node_capacity?: number
  }
  workloads?: Record<string, number>
}

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

  k8sStatus: () => request<K8sStatus>("/k8s/status"),
  k8sOverview: () => request<K8sOverview>("/k8s/overview"),
  k8sNamespaces: () => request<K8sNamespace[]>("/k8s/namespaces"),
  k8sNodes: () => request<K8sNode[]>("/k8s/nodes"),
  k8sPods: (namespace?: string) =>
    request<K8sPod[]>(`/k8s/pods${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sPod: (namespace: string, name: string) =>
    request<K8sPodDetail>(`/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`),
  k8sPodEvents: (namespace: string, name: string) =>
    request<K8sEvent[]>(`/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/events`),
  k8sPodLogs: (namespace: string, name: string, container?: string, tail = 300) =>
    request<{ logs: string }>(
      `/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs?tail=${tail}${container ? `&container=${encodeURIComponent(container)}` : ""}`,
    ),
  k8sPodDelete: (namespace: string, name: string) =>
    request<{ ok: boolean }>(`/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, { method: "DELETE" }),
  k8sPodLogsWsUrl: (namespace: string, name: string, container?: string, tail = 200) => {
    const proto = location.protocol === "https:" ? "wss" : "ws"
    const q = new URLSearchParams({ tail: String(tail), token: token.get() ?? "" })
    if (container) q.set("container", container)
    return `${proto}://${location.host}/api/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs/ws?${q}`
  },
  k8sEvents: (namespace?: string) =>
    request<K8sEvent[]>(`/k8s/events${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sDeployments: (namespace?: string) =>
    request<K8sWorkload[]>(`/k8s/deployments${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sScaleDeployment: (namespace: string, name: string, replicas: number) =>
    request<{ ok: boolean }>(`/k8s/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/scale`, {
      method: "POST", body: JSON.stringify({ replicas }),
    }),
  k8sRestartDeployment: (namespace: string, name: string) =>
    request<{ ok: boolean }>(`/k8s/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/restart`, { method: "POST" }),
  k8sStatefulSets: (namespace?: string) =>
    request<K8sWorkload[]>(`/k8s/statefulsets${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sDaemonSets: (namespace?: string) =>
    request<K8sWorkload[]>(`/k8s/daemonsets${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sJobs: (namespace?: string) =>
    request<K8sWorkload[]>(`/k8s/jobs${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sCronJobs: (namespace?: string) =>
    request<K8sWorkload[]>(`/k8s/cronjobs${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sServices: (namespace?: string) =>
    request<K8sService[]>(`/k8s/services${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sIngresses: (namespace?: string) =>
    request<K8sIngress[]>(`/k8s/ingresses${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sPvcs: (namespace?: string) =>
    request<K8sPvc[]>(`/k8s/pvcs${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sPvs: () => request<K8sPv[]>("/k8s/pvs"),
  k8sConfigMaps: (namespace?: string) =>
    request<K8sConfigMap[]>(`/k8s/configmaps${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  k8sSecrets: (namespace?: string) =>
    request<K8sSecretMeta[]>(`/k8s/secrets${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
}
