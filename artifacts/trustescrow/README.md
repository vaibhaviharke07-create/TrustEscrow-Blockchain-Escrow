# TrustEscrow

**Trustless transactions. Secure payments. No middleman.**

TrustEscrow is a hackathon MVP for buyers and sellers who do not know each other. Buyers create an escrow and lock test ETH in a Solidity contract. The seller records delivery, the buyer releases payment, and an expired, undelivered escrow can be refunded. Either participant can freeze an eligible escrow for review by the configured arbitrator.

> **Testnet only.** This project is not production financial infrastructure. Do not use real funds or deploy it to mainnet. Smart contracts should receive a professional security audit before any real-money use.

## Features

- MetaMask wallet connection and explicit Sepolia network checks
- On-chain escrow creation and exact-value ETH deposits
- Seller delivery confirmation and buyer-authorized release
- Deadline-based refund when delivery was not recorded
- Disputes that block normal settlement until arbitrator resolution
- Events for escrow state changes and explorer-linked transaction history
- Seller settlement, success, and dispute counters with a chain-derived completion rate
- Clearly separated fictional demo data for judges
- Desktop and mobile layouts

Milestone payments are not included in this MVP. The core escrow path takes priority so that payments are not represented as milestones unless each milestone is enforced by contract state.

## Project structure

```text
contracts/Escrow.sol       Solidity escrow contract
scripts/deploy.cjs         Hardhat Sepolia deployment script
test/Escrow.cjs            Contract behavior and security tests
src/                       React + Vite user interface
README.md                  Setup, deployment, and limitations
.env.example               Testnet configuration template
```

## Architecture

```text
React + ethers.js
       ↓
MetaMask
       ↓
Sepolia testnet
       ↓
Escrow.sol
       ↓
Locked test ETH + emitted state-transition events
```

The browser submits transactions through the user's MetaMask wallet. No server or frontend simulation can move funds. When no contract address is configured, live contract data and actions are shown as unavailable. The optional demo mode is visibly marked and never creates real transaction hashes.

## Requirements

- Node.js 20 or later
- pnpm
- MetaMask
- Sepolia test ETH for live testing
- A Sepolia RPC URL and a deployer wallet for deploying the contract

## Install and run

From the project root:

```bash
pnpm install
cp artifacts/trustescrow/.env.example artifacts/trustescrow/.env
pnpm --filter @workspace/trustescrow run dev
```

The Replit preview serves the TrustEscrow app. A local Vite server can also be started from the workspace using the managed TrustEscrow workflow.

## Environment configuration

Edit `artifacts/trustescrow/.env`:

```dotenv
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER_PRIVATE_KEY=
ARBITRATOR_ADDRESS=

VITE_CHAIN_ID=11155111
VITE_NETWORK_NAME=Sepolia
VITE_EXPLORER_URL=https://sepolia.etherscan.io
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_CONTRACT_ADDRESS=
VITE_DEPLOYMENT_BLOCK=
```

- `SEPOLIA_RPC_URL` is used by Hardhat; a public Sepolia endpoint is the default.
- `VITE_CHAIN_ID`, `VITE_NETWORK_NAME`, and `VITE_EXPLORER_URL` configure the frontend's expected testnet. The app accepts only supported EVM testnet chain IDs and refuses mainnet or unknown chain IDs. The included deployment script currently targets Sepolia.
- `VITE_SEPOLIA_RPC_URL` is used when MetaMask needs the Sepolia network added.
- `DEPLOYER_PRIVATE_KEY` is required only for deployment. Keep it in a local ignored `.env` or a workspace secret; never commit it or share it in chat.
- `ARBITRATOR_ADDRESS` is optional. If omitted, the deployment account is the arbitrator.
- `VITE_CONTRACT_ADDRESS` is required for live reads and transactions in the web app.
- `VITE_DEPLOYMENT_BLOCK` can be set to the deployment block to keep event-history queries bounded.
- Never put a private key or seed phrase in a `VITE_` variable. Frontend variables are public.

`.env` is ignored by Git. `.env.example` contains placeholders only.

## Compile and test

```bash
pnpm --filter @workspace/trustescrow run compile:contract
pnpm --filter @workspace/trustescrow run test:contract
pnpm --filter @workspace/trustescrow run typecheck
```

Contract tests run against Hardhat's local in-memory chain. They do not represent a testnet deployment.

## Deploy to Sepolia

1. Create a dedicated test wallet and fund it only with Sepolia test ETH.
2. Set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in the local ignored `.env` or workspace secrets. Do not use a real-funds wallet.
3. Optionally set `ARBITRATOR_ADDRESS` to a separate address you control. The arbitrator is immutable after deployment.
4. Compile and test:

   ```bash
   pnpm --filter @workspace/trustescrow run compile:contract
   pnpm --filter @workspace/trustescrow run test:contract
   ```

5. Deploy:

   ```bash
   pnpm --filter @workspace/trustescrow run deploy:sepolia
   ```

6. Copy the printed contract address and deployment block into `VITE_CONTRACT_ADDRESS` and `VITE_DEPLOYMENT_BLOCK`, then restart the frontend.
7. In MetaMask, select Sepolia, connect the buyer wallet, and create an escrow. The buyer then makes a second MetaMask transaction to deposit the exact agreed amount.
8. Connect the seller wallet to mark delivery. Reconnect the buyer wallet to release payment.

Get test ETH only from a Sepolia faucet. Never send mainnet ETH to a testnet contract.

## Contract state flow

```text
Created → Funded → Delivered → Released
                    └────────→ Disputed → Released (arbitrator pays seller)
                                  └─────→ Refunded (arbitrator pays buyer)
Funded → Refunded (buyer, after the deadline and before delivery)
Funded → Disputed → Released or Refunded (arbitrator)
```

`Created` escrows hold no funds until the buyer's separate `deposit` transaction. The refund function is limited to funded, undelivered escrows after the deadline. Once disputed, neither the buyer nor seller can release or refund through the normal functions.

## Security choices and limits

- Buyer/seller role checks, zero-address and amount validation, and future-deadline validation
- Exact-value funding: the deposit must match the amount recorded when the escrow was created and arrive before the deadline
- Effects are applied before ETH is sent, with OpenZeppelin `ReentrancyGuard` on external-value flows
- Settlement functions reject invalid or terminal states, preventing double payouts
- Important state changes emit events; transaction hashes are read from actual receipts/logs
- The arbitrator address is immutable and can choose either payout in a dispute. This is a trusted centralized MVP mechanism, not decentralized arbitration.
- Descriptions are not stored on-chain. The app may retain the creator's description in that browser only.
- Seller statistics are contract counters for this deployment, not a global reputation system. No historical reputation is invented for an address.
- Event history depends on the configured RPC provider and may need the deployment block set for providers with query-range limits.
- This is a hackathon prototype, not audited, and not production financial infrastructure.

## Demo data

Demo records are fictional examples to help judges understand the screens. They are labeled **DEMO DATA — NOT REAL TRANSACTIONS**. Live balances, contract state, statistics, and transaction links are sourced from the selected network and deployed contract; unavailable chain information must remain unavailable rather than being replaced by demo values.