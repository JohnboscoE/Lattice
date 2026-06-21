const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

export interface OnChainAgentResponse {
  agentId: string
  name: string
  agentType: string
  operator: string
  tokenAddress: string
  active: boolean
  registeredAt: number
  currentPrice: string   // 18-decimal fixed point, as string
  fdv: string            // 6-decimal USDC, as string
  graduated: boolean
  realUsdcReserve: string
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface HealthResponse {
  status: string
  service: string
  claudeApi: {
    callsUsed: number
    maxCalls: number
    remaining: number
  }
}

export function fetchHealth(): Promise<HealthResponse> {
  return request('/health')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.error ?? `Request to ${path} failed with ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function fetchAgents(): Promise<{ agents: OnChainAgentResponse[] }> {
  return request('/agents')
}

export function fetchAgent(agentId: string): Promise<{ agent: OnChainAgentResponse }> {
  return request(`/agents/${agentId}`)
}

export interface CreateTaskResponse {
  taskId: string
  txHash: string
  disputeDeadline: number
}

/**
 * Create a task in escrow for the given agent. amount must be a raw USDC
 * integer string in 6-decimal units (e.g. "2100" for $0.0021), not a float —
 * matches the backend's validation, which rejects non-integer-string amounts.
 * taskInput is the actual work content (URL or text) — stored off-chain by
 * the backend and queued for LLM processing.
 */
export function createTask(agentId: string, amount: string, taskInput: string): Promise<CreateTaskResponse> {
  return request('/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, amount, taskInput }),
  })
}

export interface TaskResponse {
  taskId: string
  requester: string
  agentId: string
  amount: string
  createdAt: number
  disputeDeadline: number
  status: number
}

export function fetchTask(taskId: string): Promise<{ task: TaskResponse }> {
  return request(`/tasks/${taskId}`)
}

export interface ReleaseTaskResponse {
  txHash: string
}

export function releaseTask(taskId: string): Promise<ReleaseTaskResponse> {
  return request(`/tasks/${taskId}/release`, { method: 'POST' })
}

export type TaskResultStatus = 'pending' | 'processing' | 'complete' | 'failed'

export interface TaskResultResponse {
  taskId: string
  status: TaskResultStatus
  result?: string
  error?: string
}

export function fetchTaskResult(taskId: string): Promise<TaskResultResponse> {
  return request(`/tasks/${taskId}/result`)
}

export interface TaskListItem {
  taskId: string
  agentId: string
  input: string
  txHash: string
  createdAt: number
  resultStatus: TaskResultStatus
  result?: string
  resultError?: string
  onChainStatus: number | null
  amount: string | null
  disputeDeadline: number | null
}

/**
 * Fetch the full shared task history — every task created this backend
 * session, regardless of which page or browser tab created it. This is the
 * source of truth used by both CreateTask and LiveDemo so history survives
 * page navigation, unlike tracking tasks in local component state.
 */
export function fetchAllTasks(): Promise<{ tasks: TaskListItem[] }> {
  return request('/tasks')
}

/**
 * Convert a raw 18-decimal fixed-point price string from the contract into
 * a human-readable USDC-per-token number.
 *
 * Done with BigInt arithmetic, not parseFloat, because currentPrice can be
 * a value like "4000000000000" which is meaningful only relative to 1e18 —
 * naive float division risks precision loss at these magnitudes.
 */
export function formatTokenPrice(raw: string): number {
  const value = BigInt(raw)
  const whole = value / 1_000_000_000_000_000_000n
  const fraction = value % 1_000_000_000_000_000_000n
  return Number(whole) + Number(fraction) / 1e18
}

/**
 * Convert a raw 6-decimal USDC string from the contract into a human-readable
 * dollar number. Safe for fdv-sized values (low billions) within JS float range.
 */
export function formatUsdc(raw: string): number {
  return Number(BigInt(raw)) / 1e6
}
