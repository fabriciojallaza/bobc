# CRE PoR Integration Guide

This document describes how the ACE stablecoin system (BOB) is integrated with the Chainlink CRE (Chainlink Runtime Environment) Proof-of-Reserve workflow.

---

## System Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BANK / BACKEND                              │
│                                                                     │
│  1. Client submits a mint request (orderId, recipient, amount)      │
│  2. POST /batch/order  →  batch-api.ts stores it as pending         │
│  3. Bank confirms funds received                                    │
│  4. POST /batch/confirm  →  orderId moves to approvedIds,           │
│                              amount added to bankBalance            │
└───────────────────┬─────────────────────────────────────────────────┘
                    │  GET /batch every 30 s
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CHAINLINK CRE WORKFLOW                           │
│             (CRE_PoR_Bool/por/main.ts)                              │
│                                                                     │
│  - Polls GET /batch → { bankBalance, approvedIds }                  │
│  - Encodes report = abi.encode(bankBalanceScaled, approvedIds)      │
│  - Calls forwarder.report(receiver, metadata, report)              │
└───────────────────┬─────────────────────────────────────────────────┘
                    │  onReport(metadata, report)
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              BatchPoRApprovalMinter (EVM contract)                  │
│                                                                     │
│  - Verifies msg.sender == forwarder                                 │
│  - Checks bankBalance has not decreased (PoR invariant)             │
│  - Verifies delta (balance increase) == sum of approved amounts     │
│  - Marks each order as Minted                                       │
│  - Calls StablecoinBOB.mint(recipient, amount) for each order       │
└───────────────────┬─────────────────────────────────────────────────┘
                    │  mint(recipient, amount)
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  StablecoinBOB (ERC-20)                             │
│                                                                     │
│  - Requires MINTER_ROLE on caller (BatchPoRApprovalMinter)          │
│  - Runs compliance hooks via PolicyManager (_update)                │
│  - Mints BOB tokens to recipient                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Contracts

### StablecoinBOB (`src/StablecoinBOB.sol`)

BOB ERC-20 stablecoin pegged to the Bolivian Peso. Key points for CRE integration:

- `mint(address to, uint256 amount)` — requires `MINTER_ROLE`. Called by `BatchPoRApprovalMinter`.
- `setMinter(address m)` — convenience wrapper that grants `MINTER_ROLE`. Requires `DEFAULT_ADMIN_ROLE`.
- All transfers run through `PolicyManager` compliance hooks (`checkMint`, `recordMint`, etc.).

### BatchPoRApprovalMinter (`src/BatchPoRApprovalMinter.sol`)

Chainlink CRE receiver contract. Implements `IReceiver.onReport()`.

- Only the trusted `forwarder` address can call `onReport`.
- Orders must be pre-registered via `createOrder` (requires `OPERATOR_ROLE`).
- `onReport` enforces that `bankBalance_new - bankBalance_old == sum(approved order amounts)`.
- Mints are atomic: all orders in the batch are minted or none are (reverts on any mismatch).

### CCIDRegistry (`src/CCIDRegistry.sol`)

Registry for KYC/compliance identities. Required by PolicyManager.

### PolicyManager (`src/PolicyManager.sol`)

Compliance rule engine. Called by StablecoinBOB on every mint, transfer, and redeem.

---

## Deploying the System

### Prerequisites

- Foundry installed (`forge`, `cast`)
- RPC endpoint configured in `foundry.toml`

### Environment variables

```bash
export ADMIN_ADDRESS=0xYourAdminAddress
export FORWARDER_ADDRESS=0xForwarderAddress   # MockForwarder (dev) or KeystoneForwarder (prod)
```

### Deploy (local Anvil)

```bash
# Start Anvil
anvil

# In another terminal
export ADMIN_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266   # Anvil account 0
export FORWARDER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 # Anvil account 1

forge script script/DeployFullSystem.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Deploy (Base Sepolia)

```bash
forge script script/DeployFullSystem.s.sol \
  --rpc-url base_sepolia \
  --broadcast \
  --verify \
  --private-key $PRIVATE_KEY
```

---

## Running the Mock Backend

The mock backend simulates the bank-side data feed. It is a plain TypeScript HTTP server with no external dependencies.

```bash
# From the ACE directory
npx ts-node backend/batch-api.ts
# Server starts on http://localhost:3000
```

Override the port with `PORT=8080 npx ts-node backend/batch-api.ts`.

### Simulating a mint flow

```bash
# 1. Register a pending order (backend receives a client request)
curl -X POST http://localhost:3000/batch/order \
  -H "Content-Type: application/json" \
  -d '{"orderId": 1, "recipient": "0xRecipientAddress", "amount": 1000000000000000000}'

# 2. Confirm the order (bank confirms funds received)
curl -X POST http://localhost:3000/batch/confirm \
  -H "Content-Type: application/json" \
  -d '{"orderId": 1}'

# 3. Verify state (CRE polls this endpoint automatically)
curl http://localhost:3000/batch
# → { "bankBalance": 1000000000000000000, "approvedIds": [1] }
```

The CRE workflow will pick up the updated `/batch` response on the next 30-second poll and call `onReport` on `BatchPoRApprovalMinter`, triggering the mint.

---

## Configuring the CRE Workflow

Edit `CRE_PoR_Bool/por/config.json` (or equivalent config file for `main.ts`):

```json
{
  "batchApiUrl": "http://localhost:3000/batch",
  "receiverAddress": "<BatchPoRApprovalMinter address from deployment>",
  "forwarderAddress": "<forwarder address>",
  "pollIntervalMs": 30000
}
```

The CRE workflow (`main.ts`) encodes the report as:

```typescript
abi.encode(["uint256", "uint256[]"], [bankBalance, approvedIds])
```

which matches what `BatchPoRApprovalMinter.onReport` expects.

---

## Role Permissions

| Role | Holder | Contract | Purpose |
|------|--------|----------|---------|
| `DEFAULT_ADMIN_ROLE` | admin EOA | StablecoinBOB | Can grant/revoke all roles, call setMinter, pause |
| `MINTER_ROLE` | BatchPoRApprovalMinter | StablecoinBOB | Allowed to call mint() |
| `DEFAULT_ADMIN_ROLE` | admin EOA | BatchPoRApprovalMinter | Can pause minting, cancel orders, set maxIdsPerReport |
| `ADMIN_ROLE` | admin EOA | BatchPoRApprovalMinter | Can pause/unpause, cancel orders |
| `OPERATOR_ROLE` | admin EOA | BatchPoRApprovalMinter | Can call createOrder() |
| `DEFAULT_ADMIN_ROLE` | admin EOA | CCIDRegistry | Can grant REGISTRAR_ROLE |
| `OPERATOR_ROLE` | StablecoinBOB | PolicyManager | Required for recordMint/recordTransfer hooks |

### Role setup performed by DeployFullSystem.s.sol

1. Deploys CCIDRegistry with `admin` as DEFAULT_ADMIN_ROLE holder.
2. Deploys PolicyManager with `admin` as DEFAULT_ADMIN_ROLE holder.
3. Deploys StablecoinBOB with `admin` as DEFAULT_ADMIN_ROLE holder.
4. Deploys BatchPoRApprovalMinter with `admin` as DEFAULT_ADMIN_ROLE, ADMIN_ROLE, and OPERATOR_ROLE holder; `forwarder` as the trusted reporter.
5. Calls `stablecoinBOB.setMinter(batchPoRApprovalMinter)` — grants MINTER_ROLE to BatchPoRApprovalMinter.
6. Calls `policyManager.grantRole(OPERATOR_ROLE, stablecoinBOB)` — allows the token's _update hook to record compliance data.

---

## Production Checklist

- [ ] Replace `MockForwarder` with the real Chainlink `KeystoneForwarder` address for the target chain.
- [ ] Replace `batch-api.ts` mock with a real adapter connected to your core banking system.
- [ ] Store orders and bank balance in a persistent database (not in-memory).
- [ ] Register KYC identities in CCIDRegistry before allowing mints to those addresses.
- [ ] Configure PolicyManager rules (transfer limits, AML thresholds) appropriate for production.
- [ ] Transfer `DEFAULT_ADMIN_ROLE` to a multisig (e.g., Gnosis Safe) before going live.
- [ ] Set `maxIdsPerReport` on BatchPoRApprovalMinter to match expected batch sizes.
- [ ] Monitor `BatchProcessed`, `Minted`, and `OrderCancelled` events for operational observability.
