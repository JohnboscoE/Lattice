import Anthropic from '@anthropic-ai/sdk'

export type TaskResultStatus = 'pending' | 'processing' | 'complete' | 'failed'

export interface StoredTask {
  taskId: string
  agentId: string
  input: string
  txHash: string
  status: TaskResultStatus
  result?: string
  error?: string
  /**
   * True if this failure is transient (rate limit, no credits, network
   * blip) and should be retried automatically by the poller once capacity
   * frees up. False for failures that are unlikely to resolve on retry
   * (e.g. Claude explicitly rejected the input) — retrying those forever
   * would just waste call budget on something that will keep failing.
   */
  retryable?: boolean
  createdAt: number
}

/**
 * In-memory store for task content and results, keyed by on-chain taskId.
 *
 * Deliberately NOT persisted on-chain: storing arbitrary task text in
 * contract storage would be expensive and pointless — the chain's job here
 * is to be the source of truth for payment, not content. This means task
 * content does not survive a server restart, which is an accepted tradeoff
 * for the current build stage, not a production-ready design.
 */
/**
 * Cache of real, previously-generated summaries keyed by exact input text.
 *
 * This is the actual fix for unbounded API cost on a long-running demo:
 * LiveDemo.tsx auto-creates tasks by cycling through a small fixed set of
 * sample inputs (see frontend SAMPLE_INPUTS). Without this cache, every
 * auto-created task — even ones with identical input text seen many times
 * before — would trigger a fresh Claude API call, meaning cost scales
 * with how long the demo runs rather than with how much genuinely new
 * content it processes.
 *
 * With this cache: the first time a given input text is seen, it gets a
 * real Claude call and the result is cached. Every subsequent task with
 * that exact same input text reuses the cached result — no new API call,
 * regardless of how many times the demo loop creates a task with that text.
 *
 * Escrow and payment remain fully real and unique per task; only the
 * summary CONTENT is reused for repeated inputs. This is a deliberate
 * tradeoff for protecting a fixed API budget during extended demo
 * sessions — not a limitation a real production deployment would need,
 * since real users submit genuinely varied content.
 */
const summaryCache = new Map<string, string>()

export function getSummaryCache() {
  return {
    size: summaryCache.size,
    entries: Array.from(summaryCache.keys()),
  }
}

const taskStore = new Map<string, StoredTask>()

export function recordTask(taskId: string, agentId: string, input: string, txHash: string): void {
  taskStore.set(taskId, {
    taskId,
    agentId,
    input,
    txHash,
    status: 'pending',
    createdAt: Date.now(),
  })
}

export function getStoredTask(taskId: string): StoredTask | undefined {
  return taskStore.get(taskId)
}

/**
 * Returns every task ever recorded this session (any status), newest first.
 * Backs GET /tasks, the shared history view used by both CreateTask and
 * LiveDemo so task history survives page navigation and tab switches —
 * previously each page only knew about tasks it personally created in its
 * own component state, which vanished on remount.
 */
export function getAllTasks(): StoredTask[] {
  return Array.from(taskStore.values()).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Rolling-window rate limit on Claude API calls, protecting against credit
 * drain WITHOUT requiring a manual backend restart to recover.
 *
 * Earlier version of this used a simple lifetime counter that only reset on
 * process restart — workable for a single local dev session, but a bad fit
 * for anything left running (a deployed demo, a long testing session):
 * once exhausted, summarization stayed broken indefinitely with no recovery
 * path except manually restarting the server.
 *
 * This version tracks the timestamp of each call and only counts calls
 * within the trailing WINDOW_MS — old calls age out automatically, so the
 * budget naturally recovers over time. Still a hard backstop against
 * runaway spend (e.g. a forgotten LiveDemo tab auto-creating tasks
 * indefinitely), just one that heals itself instead of requiring intervention.
 */
const MAX_CALLS_PER_WINDOW = 20
const WINDOW_MS = 60 * 60 * 1000 // 1 hour

let callTimestamps: number[] = []

/** Drop timestamps older than the window, then return the count remaining. */
function pruneAndCountRecentCalls(): number {
  const cutoff = Date.now() - WINDOW_MS
  callTimestamps = callTimestamps.filter(ts => ts > cutoff)
  return callTimestamps.length
}

function recordClaudeCall(): void {
  callTimestamps.push(Date.now())
}

export function getClaudeCallStats() {
  const used = pruneAndCountRecentCalls()
  const remaining = Math.max(0, MAX_CALLS_PER_WINDOW - used)

  // Time until the oldest call in the window ages out, freeing up one slot.
  // Useful for the frontend to show "resets in Xm" instead of a dead end.
  let resetsInMs: number | null = null
  if (used >= MAX_CALLS_PER_WINDOW && callTimestamps.length > 0) {
    const oldest = callTimestamps[0]
    resetsInMs = Math.max(0, oldest + WINDOW_MS - Date.now())
  }

  return {
    callsUsed: used,
    maxCalls: MAX_CALLS_PER_WINDOW,
    remaining,
    windowMs: WINDOW_MS,
    resetsInMs,
  }
}

export function getAllPendingTasks(): StoredTask[] {
  return Array.from(taskStore.values()).filter(t => t.status === 'pending')
}

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('Missing required environment variable: ANTHROPIC_API_KEY')
    }
    anthropicClient = new Anthropic({ apiKey })
  }
  return anthropicClient
}

const SUMMARIZATION_MODEL = 'claude-sonnet-4-6'
const WEB_FETCH_BETA = 'web-fetch-2025-09-10'

/** Crude check for whether the task input contains a URL worth fetching. */
function containsUrl(text: string): boolean {
  return /https?:\/\/\S+/i.test(text)
}

/**
 * Process a single stored task: call Claude to summarize its input text,
 * store the result, and update status. Does NOT touch the on-chain escrow —
 * release() is independent of task completion by design (see project notes:
 * escrow auto-releases on a timeout regardless of whether the LLM call
 * succeeds, since coupling payment to LLM success would let a flaky API
 * response freeze funds with no resolution path).
 *
 * Uses Claude's web fetch tool (beta) when the input contains a URL, so
 * Scribe-7 actually reads page content rather than guessing from the URL
 * string alone. Falls back to plain-text summarization otherwise.
 */
export async function processTask(taskId: string): Promise<void> {
  const task = taskStore.get(taskId)
  if (!task) {
    throw new Error(`No stored task content found for taskId ${taskId}`)
  }
  if (task.status !== 'pending') {
    return // already processing, complete, or failed — don't reprocess
  }

  // Cache hit: this exact input text has been summarized before. Reuse the
  // real, previously-generated result — zero API calls, not subject to the
  // rate limit at all, since no call is being made. This is what actually
  // keeps a long-running demo session (LiveDemo.tsx's auto-creation loop
  // cycling through a small fixed set of sample inputs) from scaling cost
  // with uptime instead of with genuinely new content.
  const cached = summaryCache.get(task.input)
  if (cached !== undefined) {
    task.status = 'complete'
    task.result = cached
    console.log(`Task ${taskId} used cached summary (no API call) for input: "${task.input.slice(0, 60)}..."`)
    return
  }

  const stats = getClaudeCallStats()
  if (stats.remaining <= 0) {
    // Leave status as 'pending' (don't mark 'failed') so the existing
    // poller loop — which only picks up tasks with status === 'pending' —
    // naturally retries this task on a future tick once the rolling window
    // frees up capacity. No special retry queue needed, no manual restart
    // needed. We still record an informational message so the UI can show
    // *why* it's taking a while, even though status stays pending.
    const minutesUntilReset = stats.resetsInMs ? Math.ceil(stats.resetsInMs / 60000) : null
    task.error = minutesUntilReset
      ? `Waiting for API capacity — limit resets in ~${minutesUntilReset} min.`
      : 'Waiting for API capacity.'
    console.warn(`Task ${taskId} deferred: Claude API rolling-window limit reached. Will retry automatically.`)
    return
  }

  task.status = 'processing'
  recordClaudeCall()

  try {
    const client = getClient()
    const hasUrl = containsUrl(task.input)

    const response = await client.beta.messages.create({
      model: SUMMARIZATION_MODEL,
      max_tokens: 512,
      betas: hasUrl ? [WEB_FETCH_BETA] : [],
      tools: hasUrl
        ? [
            {
              type: 'web_fetch_20250910',
              name: 'web_fetch',
              max_uses: 1,
            },
          ]
        : undefined,
      messages: [
        {
          role: 'user',
          content: hasUrl
            ? `Fetch the URL in the following text and summarize its actual content in 2-3 concise sentences:\n\n${task.input}`
            : `Summarize the following in 2-3 concise sentences:\n\n${task.input}`,
        },
      ],
    })

    const textBlocks = response.content.filter(block => block.type === 'text')
    const summary = textBlocks.length > 0
      ? textBlocks.map(b => (b.type === 'text' ? b.text : '')).join(' ').trim()
      : '(no text content returned)'

    task.result = summary
    task.status = 'complete'
    summaryCache.set(task.input, summary)
  } catch (err) {
    task.status = 'failed'
    task.error = err instanceof Error ? err.message : 'Unknown error during summarization'
    console.error(`Task ${taskId} processing failed:`, err)
  }
}

/**
 * Background poller: periodically scans for pending tasks and processes them.
 * Simple interval-based polling rather than an event-driven queue — adequate
 * for demo-scale task volume, not meant to scale beyond that.
 */
let pollerHandle: ReturnType<typeof setInterval> | null = null

export function startTaskPoller(intervalMs = 3000): void {
  if (pollerHandle) return // already running

  pollerHandle = setInterval(async () => {
    const pending = getAllPendingTasks()
    for (const task of pending) {
      await processTask(task.taskId)
    }
  }, intervalMs)

  console.log(`Task poller started (interval: ${intervalMs}ms)`)
}

export function stopTaskPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle)
    pollerHandle = null
  }
}
