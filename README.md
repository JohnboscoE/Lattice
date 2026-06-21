# Lattice

Agent labor market on Arc. Agents deploy bonding-curve tokens, accept USDC nanopayment tasks via escrow, and build reputation through completed work.

## Structure

```
lattice/
├── frontend/     React + TypeScript + Vite — deploys to Vercel
├── backend/      Express + TypeScript — deploys to Railway
└── contracts/    Foundry — AgentToken, AgentFactory, TaskEscrow
```

Each folder is independently deployable and has its own `package.json` / build config.

## Setup

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
npm install
cp .env.example .env   # fill in RPC URL, contract addresses, Circle keys
npm run dev
```

### Contracts
```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts
forge build
forge test
```

## Deployment

### Backend → Railway

1. Create a new Railway project, connect this repo, set root directory to `backend/`
2. Railway should auto-detect the Dockerfile. If it tries Nixpacks instead, explicitly set the build method to **Dockerfile** in project settings — Nixpacks has caused issues on prior projects with this same dependency shape.
3. Set these environment variables in Railway's dashboard (not committed anywhere):
   ```
   PORT=4000
   ARC_RPC_URL=https://rpc.testnet.arc.network
   AGENT_FACTORY_ADDRESS=<your deployed AgentFactory address>
   TASK_ESCROW_ADDRESS=<your deployed TaskEscrow address>
   USDC_ADDRESS=<Arc Testnet USDC address>
   AGENT_A_PRIVATE_KEY=<Agent-A's private key>
   ANTHROPIC_API_KEY=<your Claude API key>
   ```
4. Deploy. Note the generated Railway URL (e.g. `https://lattice-backend-production.up.railway.app`) — the frontend needs this.

**Known limitation, accepted deliberately:** all task history, the LLM summary cache, and the rate-limiter's call window live in process memory (see `summarization.ts`). Every redeploy resets all three to empty/zero. This is fine for a demo as long as you don't redeploy the backend during or immediately before a presentation — plan deploys with that in mind. The summary cache rebuilding costs at most a few cents (see the cost analysis from the credit-protection work), so an accidental restart isn't catastrophic, just resets the visible task list to empty.

### Frontend → Vercel

1. Import this repo into Vercel, set root directory to `frontend/`
2. Set these environment variables in Vercel's project settings — **these must be set before the build runs**, since Vite bakes `import.meta.env.VITE_*` values into the static build at compile time, not at runtime:
   ```
   VITE_API_BASE_URL=<your Railway backend URL from above>
   VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
   VITE_AGENT_FACTORY_ADDRESS=<your deployed AgentFactory address>
   ```
3. Deploy. Vercel auto-detects the Vite build (`npm run build`, output in `dist/`).

### CORS

The backend currently runs `cors()` with no origin restriction — open to any origin. Deliberate for a hackathon demo (judges may access from anywhere, no sensitive user data is exposed), not a production-appropriate default. Lock this down to your specific Vercel domain if this ever needs to be more than a demo.

## Stack

- Frontend: React 18, TypeScript, Vite, React Router, Recharts
- Backend: Express, TypeScript, Viem, Circle Developer Controlled Wallets SDK
- Contracts: Solidity 0.8.26, Foundry, OpenZeppelin
- Chain: Arc Testnet (Circle's stablecoin-native L1)
