# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BOBC (BOBs - Digital Bolivianos) is a regulated Bolivian stablecoin platform pegged 1:1 to the Boliviano (BOB), with on-chain compliance using Chainlink ACE and CRE. The repo has four main parts:

1. **`ACE/`** — Solidity smart contracts (Foundry) for the token, compliance, and oracle system
2. **`ACE/backend/`** — Node.js backend with MCP server (15 tools), HTTP API, and SQLite
3. **`CRE_PoR_Bool/`** — Two Chainlink CRE workflows (PoR batch minting + NAV oracle)
4. **`frontend/`** — React SPA for minting, redemption, dashboard, and transparency

## Build & Development

### Smart Contracts (from `ACE/`)

```bash
cd ACE
forge install        # install Solidity dependencies
forge build          # compile contracts
forge test -vvv      # run all 55 tests
forge test --match-test testFunctionName -vvv  # run a single test
forge test --match-contract ContractName -vvv  # run tests for one contract
```

### CRE Workflows (from `CRE_PoR_Bool/por/` or `CRE_PoR_Bool/nav/`)

```bash
cre workflow simulate --target staging-settings              # local simulate
cre workflow simulate --target staging-settings --broadcast  # broadcast to testnet
```

### Backend (from `ACE/backend/`)

```bash
npm install
npm run dev          # start with --watch
npm start            # production
```

### Frontend (from `frontend/`)

```bash
pnpm install        # install dependencies (pnpm is the package manager)
pnpm run dev         # start Vite dev server
pnpm run build       # production build
```

No test runner or linter is currently configured for the frontend.

## Architecture

### Smart Contracts (ACE/)

Six Solidity contracts on Base (Coinbase L2), Solidity ^0.8.24:

| Contract | Role |
|----------|------|
| `StablecoinBOB` | ERC-20 "BOBs" with `_update()` hook enforcing compliance on every transfer/mint/burn |
| `PolicyManager` | Compliance engine: KYC limits, sanctions, anti-smurfing, UIF reports (ACE mock) |
| `CCIDRegistry` | Cross-chain identity registry linking wallets to KYC credentials with tiers/expiration |
| `MinterContract` | Mints BOBs after CRE oracle confirms fiat deposit |
| `RedeemContract` | Burns BOBs + requests bank transfer with compliance checks |
| `FiatDepositOracle` | CRE mock oracle: confirms fiat deposits, tracks reserves |

Tests use a shared `BaseTest.sol` base contract. Test files follow `ContractName.t.sol` naming.

### CRE Workflows (CRE_PoR_Bool/)

Two TypeScript CRE workflows using `@chainlink/cre-sdk`:
- **`por/main.ts`** — Fetches batch API (bankBalance + approvedIds), validates, writes signed report to `CRE_BOBC` receiver contract. Enforces `delta == sum` on-chain before batch minting.
- **`nav/main.ts`** — Fetches NAV from external API, applies median DON consensus, writes to Chainlink `DataFeedsCache` on Sepolia and Base Sepolia.

### Backend (ACE/backend/)

Node.js with MCP (Model Context Protocol) server for Claude AI agent operations + HTTP API:
- `mcp-server.js` — 15 MCP tools for bank operations + on-chain admin
- `http-server.js` — REST API endpoints (KYC, orders, transparency, batch for CRE)
- `chain.js` — On-chain interaction via viem
- `db.js` — SQLite database layer

### Frontend

- **State-based routing** (not React Router): `App.tsx` uses `useState<'home' | 'buy' | 'dashboard' | 'transparency'>` and renders pages via switch. Navigation passed as `onNavigate` props.
- **Providers** (outermost to innermost): `WagmiProvider` → `QueryClientProvider` → `ThemeProvider` (next-themes)
- **API client**: `frontend/src/app/config/api.ts` — all calls go to `https://bobc.condordev.xyz`

## Styling (Frontend)

- Tailwind CSS v4 with `@tailwindcss/vite` plugin
- CSS custom properties in `theme.css` for theming (light/dark mode)
- `cn()` utility (`ui/utils.ts`) combines `clsx` + `tailwind-merge`
- Brand colors: primary `#0B1C2D` (dark blue), accent `#16C784` (green)
- Shadcn/Radix UI pattern: headless Radix primitives styled with Tailwind via `class-variance-authority`

## Conventions

- Functional components with hooks, PascalCase filenames
- Props interfaces named `{ComponentName}Props`
- Path alias: `@` resolves to `frontend/src/`
- Vite config: SVG and CSV files are configured for raw imports; never add CSS/TS/TSX to `assetsInclude`
- Use existing ui/ components before creating new ones
- Foundry remappings: `@openzeppelin/contracts/` and `forge-std/` (see `foundry.toml`)
- Web3: Wagmi v3 + Viem, configured for Ethereum Mainnet and Polygon via injected wallet
