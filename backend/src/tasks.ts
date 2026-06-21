import { publicClient, getAgentAWalletClient, requireEnvAddress, queueWrite } from './chain.js'
import { TASK_ESCROW_ABI, ERC20_ABI } from './abi.js'
import type { Address, Hash } from 'viem'
import { parseEventLogs } from 'viem'

export interface CreateTaskResult {
  taskId: string
  txHash: Hash
  disputeDeadline: number
}

export interface ReleaseTaskResult {
  txHash: Hash
}

let escrowAddress: Address | null = null
let usdcAddress: Address | null = null

function getEscrowAddress(): Address {
  if (!escrowAddress) escrowAddress = requireEnvAddress('TASK_ESCROW_ADDRESS')
  return escrowAddress
}

function getUsdcAddress(): Address {
  if (!usdcAddress) usdcAddress = requireEnvAddress('USDC_ADDRESS')
  return usdcAddress
}

/**
 * Ensure Agent-A's wallet has approved TaskEscrow to pull at least `amount`
 * USDC. Checks current allowance first to avoid sending a redundant approve
 * transaction (and paying gas for it) on every task.
 */
async function ensureUsdcApproval(amount: bigint): Promise<void> {
  const wallet = getAgentAWalletClient()
  const usdc = getUsdcAddress()
  const escrow = getEscrowAddress()

  if (!wallet.account) {
    throw new Error('Agent-A wallet client has no account configured')
  }

  const currentAllowance = await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [wallet.account.address, escrow],
  })

  if (currentAllowance >= amount) return

  // Approve a large headroom rather than the exact amount, so repeated demo
  // task creation doesn't require a fresh approval transaction every time.
  const approvalAmount = amount * 1000n

  const hash = await wallet.writeContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [escrow, approvalAmount],
    chain: wallet.chain,
    account: wallet.account,
  })

  await publicClient.waitForTransactionReceipt({ hash })
}

/**
 * Create a task in escrow as Agent-A, locking `amount` USDC (6-decimal units)
 * for the given agentId. Approves USDC spend first if the current allowance
 * is insufficient.
 *
 * Returns the real taskId decoded from the TaskCreated event in the
 * transaction receipt — NOT the function's solidity return value, since that
 * is only retrievable via simulation, not from an actually-sent transaction.
 */
export async function createTask(agentId: `0x${string}`, amount: bigint): Promise<CreateTaskResult> {
  return queueWrite(async () => {
    const wallet = getAgentAWalletClient()
    const escrow = getEscrowAddress()

    if (!wallet.account) {
      throw new Error('Agent-A wallet client has no account configured')
    }

    await ensureUsdcApproval(amount)

    const hash = await wallet.writeContract({
      address: escrow,
      abi: TASK_ESCROW_ABI,
      functionName: 'createTask',
      args: [agentId, amount],
      chain: wallet.chain,
      account: wallet.account,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    const createdEvents = parseEventLogs({
      abi: TASK_ESCROW_ABI,
      eventName: 'TaskCreated',
      logs: receipt.logs,
    })

    const createdEvent = createdEvents[0]

    if (!createdEvent) {
      throw new Error('TaskCreated event not found in transaction receipt — task may not have been created')
    }

    return {
      taskId: createdEvent.args.taskId,
      txHash: hash,
      disputeDeadline: Number(createdEvent.args.disputeDeadline),
    }
  })
}

/**
 * Release a task's escrowed funds to the agent operator. Callable by anyone
 * once the dispute window has passed — uses Agent-A's wallet here for
 * simplicity, but in production this could be triggered by any relayer,
 * the agent itself, or a cron job, since the contract has no caller
 * restriction on release().
 */
export async function releaseTask(taskId: `0x${string}`): Promise<ReleaseTaskResult> {
  return queueWrite(async () => {
    const wallet = getAgentAWalletClient()
    const escrow = getEscrowAddress()

    if (!wallet.account) {
      throw new Error('Agent-A wallet client has no account configured')
    }

    const canRelease = await publicClient.readContract({
      address: escrow,
      abi: TASK_ESCROW_ABI,
      functionName: 'canRelease',
      args: [taskId],
    })

    if (!canRelease) {
      throw new Error('Task is not yet releasable — dispute window may still be open, or task was already resolved')
    }

    const hash = await wallet.writeContract({
      address: escrow,
      abi: TASK_ESCROW_ABI,
      functionName: 'release',
      args: [taskId],
      chain: wallet.chain,
      account: wallet.account,
    })

    await publicClient.waitForTransactionReceipt({ hash })

    return { txHash: hash }
  })
}

/**
 * Read current task state directly from the contract.
 */
export async function getTask(taskId: `0x${string}`) {
  const escrow = getEscrowAddress()

  const result = await publicClient.readContract({
    address: escrow,
    abi: TASK_ESCROW_ABI,
    functionName: 'tasks',
    args: [taskId],
  })

  const [requester, agentId, amount, createdAt, disputeDeadline, status] = result

  return {
    taskId,
    requester,
    agentId,
    amount: amount.toString(),
    createdAt: Number(createdAt),
    disputeDeadline: Number(disputeDeadline),
    status: Number(status),
  }
}
