import express, { Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fetchAllAgents, fetchAgentById } from './agents.js'
import { createTask, releaseTask, getTask } from './tasks.js'
import { recordTask, getStoredTask, getAllTasks, startTaskPoller, getClaudeCallStats, getSummaryCache } from './summarization.js'

dotenv.config()

/**
 * Crash protection: log unhandled errors instead of letting them kill the
 * process. This matters specifically because all state in this backend
 * (taskStore, summaryCache, the rate-limiter's call timestamps) lives in
 * memory — see summarization.ts for the rationale. A crash-triggered
 * restart silently wipes all of it: task history, cached summaries (which
 * is the actual cost-control mechanism for a long-running demo), and the
 * rate-limit window. This won't prevent a deliberate redeploy from wiping
 * state (expected, accepted tradeoff), but it does prevent an UNPLANNED
 * restart from doing the same thing mid-demo due to an uncaught error
 * somewhere in a request handler or the background poller.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (process kept alive):', reason)
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (process kept alive):', err)
})

const app = express()
const PORT = process.env.PORT ?? 4000

app.use(cors())
app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'lattice-backend',
    claudeApi: getClaudeCallStats(),
    summaryCache: getSummaryCache(),
  })
})

/**
 * GET /agents
 * Returns all agents registered on AgentFactory, with live price/fdv data
 * pulled directly from each agent's AgentToken contract on Arc Testnet.
 */
app.get('/agents', async (_req: Request, res: Response) => {
  try {
    const agents = await fetchAllAgents()
    res.json({ agents })
  } catch (err) {
    console.error('GET /agents failed:', err)
    res.status(500).json({ error: 'Failed to fetch agents from chain' })
  }
})

/**
 * GET /agents/:agentId
 * Returns a single agent by its bytes32 agentId (hex string, 0x-prefixed, 66 chars).
 */
app.get('/agents/:agentId', async (req: Request, res: Response) => {
  const { agentId } = req.params

  if (!/^0x[a-fA-F0-9]{64}$/.test(agentId)) {
    res.status(400).json({ error: 'agentId must be a 0x-prefixed 32-byte hex string' })
    return
  }

  try {
    const agent = await fetchAgentById(agentId as `0x${string}`)
    res.json({ agent })
  } catch (err) {
    console.error(`GET /agents/${agentId} failed:`, err)
    res.status(404).json({ error: 'Agent not found or chain read failed' })
  }
})

/**
 * POST /tasks
 * Body: {
 *   agentId: string (bytes32 hex),
 *   amount: string (USDC 6-decimal units, as string to avoid precision loss),
 *   taskInput: string (the actual work content — URL or text to summarize)
 * }
 *
 * Creates a task in TaskEscrow, signed by Agent-A's wallet. Approves USDC
 * spend first if needed. Returns the real on-chain taskId decoded from the
 * TaskCreated event, plus the transaction hash for verification.
 *
 * taskInput is stored off-chain (in-memory, not persisted on-chain — see
 * summarization.ts for rationale) and queued for processing by the
 * background poller, which calls Claude to actually do the summarization
 * work. This is independent of escrow release: payment follows the
 * contract's timeout logic regardless of whether/when the LLM call completes.
 */
app.post('/tasks', async (req: Request, res: Response) => {
  const { agentId, amount, taskInput } = req.body ?? {}

  if (typeof agentId !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(agentId)) {
    res.status(400).json({ error: 'agentId must be a 0x-prefixed 32-byte hex string' })
    return
  }

  if (typeof amount !== 'string' || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    res.status(400).json({ error: 'amount must be a positive integer string (USDC 6-decimal units)' })
    return
  }

  if (typeof taskInput !== 'string' || taskInput.trim().length === 0) {
    res.status(400).json({ error: 'taskInput must be a non-empty string' })
    return
  }

  try {
    const result = await createTask(agentId as `0x${string}`, BigInt(amount))
    recordTask(result.taskId, agentId, taskInput, result.txHash)
    res.status(201).json(result)
  } catch (err) {
    console.error('POST /tasks failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create task' })
  }
})

/**
 * GET /tasks
 * Returns every task created this session (any status), newest first, with
 * both off-chain content (input, LLM result) and live on-chain status merged
 * together. This is the shared source of truth for task history — used by
 * both the task-creation form and the live demo page, so history survives
 * navigating away and back, unlike component-local state.
 *
 * On-chain reads happen in parallel per task; a failed on-chain read for any
 * single task does not fail the whole list — that task just falls back to
 * its last-known off-chain status.
 */
app.get('/tasks', async (_req: Request, res: Response) => {
  const stored = getAllTasks()

  const enriched = await Promise.all(
    stored.map(async task => {
      try {
        const onChain = await getTask(task.taskId as `0x${string}`)
        return {
          taskId: task.taskId,
          agentId: task.agentId,
          input: task.input,
          txHash: task.txHash,
          createdAt: task.createdAt,
          resultStatus: task.status,
          result: task.result,
          resultError: task.error,
          onChainStatus: onChain.status,
          amount: onChain.amount,
          disputeDeadline: onChain.disputeDeadline,
        }
      } catch (err) {
        console.error(`On-chain read failed for task ${task.taskId} in list view:`, err)
        return {
          taskId: task.taskId,
          agentId: task.agentId,
          input: task.input,
          txHash: task.txHash,
          createdAt: task.createdAt,
          resultStatus: task.status,
          result: task.result,
          resultError: task.error,
          onChainStatus: null,
          amount: null,
          disputeDeadline: null,
        }
      }
    })
  )

  res.json({ tasks: enriched })
})

/**
 * GET /tasks/:taskId
 * Returns current on-chain state for a task.
 */
app.get('/tasks/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params

  if (!/^0x[a-fA-F0-9]{64}$/.test(taskId)) {
    res.status(400).json({ error: 'taskId must be a 0x-prefixed 32-byte hex string' })
    return
  }

  try {
    const task = await getTask(taskId as `0x${string}`)
    res.json({ task })
  } catch (err) {
    console.error(`GET /tasks/${taskId} failed:`, err)
    res.status(404).json({ error: 'Task not found or chain read failed' })
  }
})

/**
 * POST /tasks/:taskId/release
 * Releases escrowed funds to the agent operator, if the dispute window has
 * passed. Anyone can call this on-chain; this endpoint uses Agent-A's wallet
 * for convenience in the demo, but the contract itself has no caller
 * restriction on release().
 */
app.post('/tasks/:taskId/release', async (req: Request, res: Response) => {
  const { taskId } = req.params

  if (!/^0x[a-fA-F0-9]{64}$/.test(taskId)) {
    res.status(400).json({ error: 'taskId must be a 0x-prefixed 32-byte hex string' })
    return
  }

  try {
    const result = await releaseTask(taskId as `0x${string}`)
    res.json(result)
  } catch (err) {
    console.error(`POST /tasks/${taskId}/release failed:`, err)
    res.status(409).json({ error: err instanceof Error ? err.message : 'Failed to release task' })
  }
})

/**
 * GET /tasks/:taskId/result
 * Returns the off-chain processing status and, once available, the actual
 * summary produced by Claude. Status values: pending, processing, complete, failed.
 * 404 if no task content was ever recorded for this taskId (e.g. it was
 * created before this route existed, or recordTask was never called).
 */
app.get('/tasks/:taskId/result', (req: Request, res: Response) => {
  const { taskId } = req.params

  if (!/^0x[a-fA-F0-9]{64}$/.test(taskId)) {
    res.status(400).json({ error: 'taskId must be a 0x-prefixed 32-byte hex string' })
    return
  }

  const stored = getStoredTask(taskId)
  if (!stored) {
    res.status(404).json({ error: 'No task content found for this taskId' })
    return
  }

  res.json({
    taskId: stored.taskId,
    status: stored.status,
    result: stored.result,
    error: stored.error,
  })
})

startTaskPoller()

app.listen(PORT, () => {
  console.log(`Lattice backend running on port ${PORT}`)
})
