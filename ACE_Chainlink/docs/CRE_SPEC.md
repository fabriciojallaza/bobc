# Chainlink CRE Oracle Specification — BOB Stablecoin

> **Version:** 1.0
> **Date:** 2026-03-04
> **Audience:** External development team implementing the CRE jobs
> **Status:** Production specification

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Architecture](#2-system-architecture)
3. [What the CRE Does and Does NOT Do](#3-what-the-cre-does-and-does-not-do)
4. [Job 1: FiatDepositConfirmation](#4-job-1-fiatdepositconfirmation)
5. [Job 2: ProofOfReserves](#5-job-2-proofofreserves)
6. [Job 3: RedeemExecution](#6-job-3-redeemexecution)
7. [Contract Interfaces](#7-contract-interfaces)
8. [Security and Authentication](#8-security-and-authentication)
9. [Error Handling Reference](#9-error-handling-reference)
10. [Setup and Configuration](#10-setup-and-configuration)
11. [Environments](#11-environments)
12. [Monitoring and Logging](#12-monitoring-and-logging)

---

## 1. Introduction

### What is BOB Stablecoin?

BOB Stablecoin is an ERC-20 token on the Base blockchain (Coinbase L2) pegged 1:1 to the Bolivian Boliviano (BOB). It is backed by fiat reserves held in a custodial bank account in Bolivia. Users deposit Bolivianos at the bank and receive tokens; they can burn tokens to redeem Bolivianos back to their bank account.

### What is Chainlink CRE?

Chainlink CRE (Compute Runtime Environment) is Chainlink's offchain computation layer. It allows developers to define **jobs** — units of work that run offchain but can read from and write to the blockchain. Each job has a trigger (what starts it), computation logic (validations, data transformations), and an output (onchain transaction or external API call).

In this system, the CRE acts as the **bridge between the Bolivian banking system and the smart contracts on Base**. It reads data from the bank API, validates it, transforms it into the format the contracts expect, and sends transactions to the blockchain.

### What is the CRE's role in this system?

The CRE runs **3 independent jobs**:

| Job | What it does | Trigger |
|-----|-------------|---------|
| **FiatDepositConfirmation** | Confirms a bank deposit and triggers token minting | Bank webhook or polling |
| **ProofOfReserves** | Reports the custodial bank balance onchain | Chainlink Automation (every 24h) |
| **RedeemExecution** | Executes a bank transfer when a user redeems tokens | Onchain event |

### What are you building?

You are building the **3 CRE jobs** that connect the bank to the blockchain. Specifically:

```
                          YOU BUILD THIS
                    ┌─────────────────────────┐
                    │     Chainlink CRE        │
                    │                          │
  ┌──────────┐     │  ┌─────────────────────┐ │     ┌────────────────────────┐
  │          │     │  │ Job 1: Deposit      │ │     │                        │
  │  Banco   │◄───►│  │ Job 2: Reserves     │ │────►│  Smart Contracts       │
  │  BOL     │     │  │ Job 3: Redeem       │ │◄────│  on Base               │
  │  (API)   │     │  └─────────────────────┘ │     │                        │
  │          │     │                          │     │  FiatDepositOracle      │
  └──────────┘     │  Uses:                   │     │  MinterContract         │
                    │  - Bank API (REST/OAuth) │     │  RedeemContract         │
                    │  - ethers.js (txs)      │     │  CCIDRegistry (read)    │
                    │  - Chainlink Secrets    │     │                        │
                    │  - Chainlink Automation │     └────────────────────────┘
                    └─────────────────────────┘
```

Your CRE jobs must:
- Authenticate with the bank API (OAuth2) and verify bank responses (HMAC-SHA256)
- Validate all data before sending onchain transactions
- Handle the full lifecycle: trigger → validate → transform → transact → confirm
- Handle errors gracefully with retries and alerting
- Log every operation for audit compliance

### What is the MCP?

The MCP (Model Context Protocol) is a separate middleware that provides tools to the AI agent operating the system. The MCP handles user onboarding, compliance enforcement, and some bank API calls. The MCP is documented in `BANK_MCP_SPEC.md`.

**The CRE and MCP are complementary but independent systems.** They both interact with the bank API and the smart contracts, but they have different roles (the CRE has `ORACLE_ROLE`, the MCP has `REGISTRAR_ROLE` + `OPERATOR_ROLE`) and different responsibilities. You do NOT need to implement MCP functionality.

### Smart Contracts

The following contracts are deployed on Base. Your CRE jobs interact with 4 of them:

| Contract | CRE Interacts? | How | Purpose |
|----------|----------------|-----|---------|
| `FiatDepositOracle` | **Yes — write** | `confirmDeposit()`, `updateReserves()` | Receives oracle data |
| `MinterContract` | **Yes — write** | `mint()` | Mints tokens after deposit confirmation |
| `RedeemContract` | **Yes — read+write** | Listens to `RedeemRequested` event, calls `confirmRedeemExecuted()` | Handles redemptions |
| `CCIDRegistry` | **Yes — read only** | `hasCCID()`, `getWallet()` | Checks if user has registered identity |
| `PolicyManager` | No | — | Compliance enforcement (handled by token hooks, transparent to CRE) |
| `StablecoinBOB` | No | — | ERC-20 token (minted by MinterContract, not by CRE directly) |

Contract ABIs and addresses will be provided after deployment.

---

## 2. System Architecture

### Complete system overview

```
                            OFFCHAIN                                  ONCHAIN (Base)

                                                           ┌─────────────────────────────────┐
┌──────────┐    ┌────────────────────┐                     │        Smart Contracts           │
│          │    │   Chainlink CRE    │                     │                                  │
│  Banco   │    │                    │    ORACLE_ROLE       │  ┌──────────────────────┐        │
│  BOL     │◄──►│  Job 1: Deposit    │───────────────────►  │  │  FiatDepositOracle   │        │
│  (API)   │    │  Job 2: Reserves   │                     │  │  - confirmDeposit()  │        │
│          │    │  Job 3: Redeem     │◄───────────────────  │  │  - updateReserves()  │        │
└──────────┘    │                    │    events            │  └──────────────────────┘        │
                └────────────────────┘                     │                                  │
                                                           │  ┌──────────────────────┐        │
┌──────────┐    ┌────────────────────┐                     │  │  MinterContract      │        │
│  MCP     │    │   Chainlink        │                     │  │  - mint()            │        │
│  Server  │    │   Automation       │  time-based          │  └──────────────────────┘        │
│  (agent) │    │   (Keeper)         │──trigger────────────►│                                  │
└──────────┘    └────────────────────┘                     │  ┌──────────────────────┐        │
     │                                                     │  │  RedeemContract      │        │
     │          REGISTRAR_ROLE +                           │  │  - confirmRedeem()   │        │
     └──────────OPERATOR_ROLE──────────────────────────────►│  └──────────────────────┘        │
                                                           │                                  │
                                                           │  ┌──────────────────────┐        │
                                                           │  │  CCIDRegistry         │        │
                                                           │  │  - hasCCID() [view]  │        │
                                                           │  │  - getWallet() [view]│        │
                                                           │  └──────────────────────┘        │
                                                           │                                  │
                                                           │  ┌──────────────────────┐        │
                                                           │  │  PolicyManager        │        │
                                                           │  │  (NOT called by CRE)  │        │
                                                           │  └──────────────────────┘        │
                                                           │                                  │
                                                           │  ┌──────────────────────┐        │
                                                           │  │  StablecoinBOB       │        │
                                                           │  │  (NOT called by CRE)  │        │
                                                           │  └──────────────────────┘        │
                                                           └─────────────────────────────────┘
```

### Role separation

The CRE wallet has exactly one role: `ORACLE_ROLE`. This role is granted by the admin multisig (Gnosis Safe, 3/5 signatures) and gives permission to call:

- `FiatDepositOracle.confirmDeposit()`
- `FiatDepositOracle.updateReserves()`
- `MinterContract.mint()`
- `RedeemContract.confirmRedeemExecuted()`

The CRE wallet does NOT have `REGISTRAR_ROLE`, `OPERATOR_ROLE`, or `ADMIN_ROLE`. It cannot register identities, freeze wallets, change parameters, or upgrade contracts.

---

## 3. What the CRE Does and Does NOT Do

### What the CRE DOES

| Responsibility | Job | Contract function |
|---------------|-----|-------------------|
| Confirm bank deposits onchain | Job 1 | `FiatDepositOracle.confirmDeposit()` |
| Trigger token minting after confirmation | Job 1 | `MinterContract.mint()` |
| Report custodial balance onchain | Job 2 | `FiatDepositOracle.updateReserves()` |
| Execute bank transfers for redemptions | Job 3 | Bank API `POST /api/transfers` |
| Confirm redemption completion onchain | Job 3 | `RedeemContract.confirmRedeemExecuted()` |
| Validate bank data (HMAC, timestamps, amounts) | All | — |
| Resolve userId to wallet address | Job 1 | `CCIDRegistry.getWallet()` (read) |

### What the CRE does NOT do

These responsibilities belong to other components. Do NOT implement them in the CRE:

| Responsibility | Who handles it | Why not CRE |
|---------------|---------------|-------------|
| **Verify KYC / identity** | MCP server → CCIDRegistry | The CRE only checks IF a user has a registered identity (`hasCCID`). It does not register, revoke, or verify identities. |
| **Apply compliance rules** | PolicyManager (via token hooks) | Compliance checks (AML limits, sanctions, frozen wallets) are enforced automatically by `StablecoinBOB._beforeTokenTransfer()`. When the CRE calls `MinterContract.mint()`, the token's internal hooks check PolicyManager. If compliance fails, the mint reverts. The CRE does not need to check PolicyManager itself. |
| **Decide if minting is allowed** | Smart contracts | The CRE submits the deposit data. The contracts decide whether to accept it (is the user registered? is minting paused? is the amount within limits?). If the contract reverts, the CRE handles the revert — it does not pre-check compliance rules. |
| **Register users** | MCP server (REGISTRAR_ROLE) | User onboarding is handled by the AI agent via the MCP. |
| **Freeze/unfreeze wallets** | MCP server (OPERATOR_ROLE) | Compliance enforcement is handled by the AI agent via the MCP. |
| **Change system parameters** | Admin multisig (ADMIN_ROLE) | Fees, limits, thresholds require human approval. |
| **Transfer tokens** | Users directly | Standard ERC-20 transfers between users. |

**Key principle:** The CRE is a **data bridge**, not a decision maker. It reads data from the bank, validates its authenticity (HMAC, timestamps), transforms it into the format contracts expect, and submits transactions. The smart contracts enforce all business rules.

---

## 4. Job 1: FiatDepositConfirmation

### Purpose

When a user deposits Bolivianos at the bank, this job confirms the deposit onchain and triggers the minting of an equivalent amount of BOB tokens to the user's wallet.

### Flow diagram

```
  Bank              CRE Job 1            CCIDRegistry        FiatDepositOracle    MinterContract    StablecoinBOB
   │                    │                      │                    │                   │                 │
   │  webhook POST      │                      │                    │                   │                 │
   │  (or polling GET)  │                      │                    │                   │                 │
   │───────────────────►│                      │                    │                   │                 │
   │  {txId, userId,    │                      │                    │                   │                 │
   │   amount, ...}     │                      │                    │                   │                 │
   │                    │                      │                    │                   │                 │
   │                    │ ── STEP 1: Validate ─┤                    │                   │                 │
   │                    │  Verify HMAC sig      │                    │                   │                 │
   │                    │  Check timestamp      │                    │                   │                 │
   │                    │  Check amount > 0     │                    │                   │                 │
   │                    │  Check currency=BOB   │                    │                   │                 │
   │                    │                      │                    │                   │                 │
   │                    │ ── STEP 2: Resolve ──┤                    │                   │                 │
   │                    │  hasCCID(userId)?     │                    │                   │                 │
   │                    │─────────────────────►│                    │                   │                 │
   │                    │  true                │                    │                   │                 │
   │                    │◄─────────────────────│                    │                   │                 │
   │                    │  getWallet(userId)    │                    │                   │                 │
   │                    │─────────────────────►│                    │                   │                 │
   │                    │  0x742d...           │                    │                   │                 │
   │                    │◄─────────────────────│                    │                   │                 │
   │                    │                      │                    │                   │                 │
   │                    │ ── STEP 3: Dedup ────┤                    │                   │                 │
   │                    │  isProcessed(txId)?   │                    │                   │                 │
   │                    │──────────────────────┼───────────────────►│                   │                 │
   │                    │  false               │                    │                   │                 │
   │                    │◄─────────────────────┼────────────────────│                   │                 │
   │                    │                      │                    │                   │                 │
   │                    │ ── STEP 4: Convert ──┤                    │                   │                 │
   │                    │  txId string→bytes32  │                    │                   │                 │
   │                    │  amount→uint256(18d)  │                    │                   │                 │
   │                    │                      │                    │                   │                 │
   │                    │ ── STEP 5: Confirm ──┤                    │                   │                 │
   │                    │  confirmDeposit(      │                    │                   │                 │
   │                    │    txId, wallet, amt) │                    │                   │                 │
   │                    │──────────────────────┼───────────────────►│                   │                 │
   │                    │  DepositConfirmed     │                    │                   │                 │
   │                    │◄─────────────────────┼────────────────────│                   │                 │
   │                    │                      │                    │                   │                 │
   │                    │ ── STEP 6: Mint ─────┤                    │                   │                 │
   │                    │  mint(txId)           │                    │                   │                 │
   │                    │──────────────────────┼────────────────────┼──────────────────►│                 │
   │                    │                      │                    │                   │  mint(wallet,   │
   │                    │                      │                    │                   │       amount)   │
   │                    │                      │                    │                   │────────────────►│
   │                    │                      │                    │                   │                 │
   │                    │                      │                    │                   │  (PolicyManager │
   │                    │                      │                    │                   │   checks auto)  │
   │                    │                      │                    │                   │                 │
   │                    │  TokensMinted         │                    │                   │                 │
   │                    │◄─────────────────────┼────────────────────┼───────────────────│                 │
   │                    │                      │                    │                   │                 │
   ▼                    ▼                      ▼                    ▼                   ▼                 ▼
```

### Trigger

**Option A — Webhook (preferred):**
The bank sends an HTTP POST to the CRE's webhook endpoint when a new deposit is received.

```
POST https://<cre-webhook-url>/deposit
Content-Type: application/json
X-Bank-Signature: <hmac-sha256-of-body>

{
  "txId": "DEP-2026-00001",
  "userId": "USR-BOL-12345",
  "amount": 1000.00,
  "currency": "BOB",
  "bankAccountId": "ACCT-001-CUSTODIA",
  "timestamp": "2026-03-04T14:30:00Z"
}
```

**Option B — Polling (fallback):**
If the webhook is unavailable, the CRE polls the bank API every 5 minutes:

```
GET /api/deposits/pending
Authorization: Bearer {oauth_token}
```

Returns an array of unprocessed deposits in the same format.

### SLA

| Metric | Target |
|--------|--------|
| Time from deposit to mint | < 10 minutes |
| Priority | High — directly affects user experience |

### Input data format

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `txId` | string | Unique bank transaction ID. Format: `DEP-YYYY-NNNNN+` | `"DEP-2026-00001"` |
| `userId` | string | User ID in bank system. Format: `USR-BOL-NNNNN` | `"USR-BOL-12345"` |
| `amount` | number | Deposit amount in Bolivianos. Two decimal places. | `1000.00` |
| `currency` | string | Must be `"BOB"` | `"BOB"` |
| `bankAccountId` | string | Source bank account ID | `"ACCT-001-CUSTODIA"` |
| `timestamp` | string (ISO 8601) | When the deposit was received by the bank | `"2026-03-04T14:30:00Z"` |

### Step-by-step processing

#### Step 1: Validate bank data

Run these checks IN ORDER. If any check fails, stop and do not proceed to the next step.

| # | Check | Condition | If fails |
|---|-------|-----------|----------|
| 1 | HMAC signature | `HMAC-SHA256(request_body, BANK_HMAC_SECRET)` matches `X-Bank-Signature` header | Reject with `INVALID_SIGNATURE`. Log as security alert. |
| 2 | Nonce (anti-replay) | `response.nonce > lastSeenNonce` | Reject with `REPLAY_DETECTED`. Log as security alert. Update `lastSeenNonce` on success. |
| 3 | Timestamp freshness | `now() - timestamp < 24 hours` | Reject with `STALE_DEPOSIT`. Log. |
| 4 | Amount | `amount > 0` | Reject with `INVALID_AMOUNT`. |
| 5 | Currency | `currency == "BOB"` | Reject with `INVALID_CURRENCY`. |
| 6 | txId format | Matches pattern `^DEP-\d{4}-\d{5,}$` | Reject with `INVALID_TX_ID`. |

#### Step 2: Resolve user identity (onchain reads)

| # | Action | Contract call | If fails |
|---|--------|--------------|----------|
| 7 | Check user has identity | `CCIDRegistry.hasCCID(userId)` → `bool` | If false: reject with `NO_CCID`. The user has not completed KYC onboarding. |
| 8 | Get user's wallet address | `CCIDRegistry.getWallet(userId)` → `address` | If returns `address(0)`: reject with `NO_WALLET`. |

#### Step 3: Check for duplicates (onchain read)

| # | Action | Contract call | If fails |
|---|--------|--------------|----------|
| 9 | Check if already processed | `FiatDepositOracle.isProcessed(keccak256(txId))` → `bool` | If true: skip silently (idempotent). Log as `DUPLICATE_TX`. |
| 10 | Check if minting is paused | `FiatDepositOracle.mintPaused()` → `bool` | If true: queue the deposit for later. Do NOT discard. Log as `MINT_PAUSED`. |

#### Step 4: Data conversion

Transform bank data into the format the smart contracts expect:

| Source field | Transformation | Target field | Solidity type |
|-------------|----------------|-------------|---------------|
| `txId` (string) | `keccak256(abi.encodePacked(txId))` | `txId` | `bytes32` |
| `userId` (string) | Lookup: `CCIDRegistry.getWallet(userId)` | `userWallet` | `address` |
| `amount` (number, 2 decimals) | `Math.round(amount * 1e18)` | `amount` | `uint256` |

**Conversion details:**

- **txId → bytes32:** Use `ethers.keccak256(ethers.toUtf8Bytes(txId))` (ethers.js v6) or equivalent. This produces a deterministic 32-byte hash from the string. The same string always produces the same hash, enabling idempotency checks via `isProcessed()`.

- **amount → uint256:** The bank sends amounts with 2 decimal places (e.g., `1000.00`). The ERC-20 token uses 18 decimals. Multiply by `1e18`. Example: `1000.00 * 1e18 = 1000000000000000000000` (1000 followed by 18 zeros). Use BigInt or a library like `ethers.parseUnits(amount.toString(), 18)` to avoid floating point errors.

#### Step 5: Confirm deposit onchain

Send a transaction to record the deposit:

```
FiatDepositOracle.confirmDeposit(bytes32 txId, address userWallet, uint256 amount)
```

- **Caller:** CRE wallet (must have `ORACLE_ROLE`)
- **Gas estimate:** ~80,000 gas
- **Wait for:** 1 block confirmation minimum
- **Emits:** `DepositConfirmed(bytes32 indexed txId, address indexed userWallet, uint256 amount)`

**If the transaction reverts:** See [Error Handling Reference](#9-error-handling-reference) for revert reasons and actions.

#### Step 6: Mint tokens

After `confirmDeposit` succeeds, trigger the mint:

```
MinterContract.mint(bytes32 txId)
```

- **Caller:** CRE wallet (must have `ORACLE_ROLE`)
- **Gas estimate:** ~120,000 gas (includes ERC-20 mint + compliance hook checks)
- **Wait for:** 1 block confirmation minimum
- **Emits:** `TokensMinted(bytes32 indexed txId, address indexed userWallet, uint256 amount)`

**What happens inside `mint()`:**
1. MinterContract reads the deposit data from FiatDepositOracle (txId, wallet, amount)
2. MinterContract calls `StablecoinBOB.mint(userWallet, amount)`
3. StablecoinBOB's `_beforeTokenTransfer` hook calls `PolicyManager.checkMint(userWallet, amount)`
4. If PolicyManager approves → tokens are minted to userWallet
5. If PolicyManager rejects → the entire transaction reverts

**The CRE does NOT need to check PolicyManager.** The compliance check happens automatically inside the mint transaction. If the user is frozen, sanctioned, or exceeds limits, the mint will revert and the CRE handles the revert error.

**If the mint reverts but confirmDeposit succeeded:** The deposit is recorded onchain but tokens were not minted. This can happen if the user was frozen between Steps 5 and 6. Log this as `MINT_BLOCKED_BY_COMPLIANCE` and alert admin. The deposit data is safe onchain — a manual resolution may re-trigger the mint later.

### Retry policy

| Attempt | Delay | Notes |
|---------|-------|-------|
| 1 | Immediate | First try |
| 2 | 30 seconds | After first failure |
| 3 | 2 minutes | After second failure |

After 3 failed attempts:
1. Log the failure with all details
2. Alert admin via configured alerting channel
3. Mark the deposit as `FAILED_ONCHAIN` in the monitoring system
4. Do NOT discard the deposit — it must be retried manually

**Which errors are retryable:**

| Error | Retryable? | Why |
|-------|-----------|-----|
| `TX_REVERTED` (generic) | Yes | May be a temporary state |
| `TX_REVERTED` (TxAlreadyProcessed) | No | Already done (idempotent) |
| `TX_REVERTED` (MintPaused) | No | Wait until reserves are updated |
| `TX_REVERTED` (AccessControl) | No | Role not granted — configuration error |
| `TX_REVERTED` (compliance rejection) | No | User blocked by PolicyManager — escalate |
| `INSUFFICIENT_GAS` | No | Fund wallet first |
| `RPC_UNAVAILABLE` | Yes | Try fallback RPC |
| `NONCE_TOO_LOW` | Yes | Re-fetch nonce |

---

## 5. Job 2: ProofOfReserves

### Purpose

Every 24 hours, this job queries the bank for the current balance of the custodial account and writes it onchain. This allows anyone to verify that the total token supply is fully backed by fiat reserves. If the reserves fall below the token supply, minting is automatically paused by the smart contract.

### Flow diagram

```
  Chainlink            CRE Job 2              Bank API           FiatDepositOracle
  Automation
   │                      │                      │                      │
   │  time trigger        │                      │                      │
   │  (every 24h)         │                      │                      │
   │─────────────────────►│                      │                      │
   │                      │                      │                      │
   │                      │ ── STEP 1: Fetch ───┤                      │
   │                      │  GET /api/reserves   │                      │
   │                      │─────────────────────►│                      │
   │                      │  {balance, ...}      │                      │
   │                      │◄─────────────────────│                      │
   │                      │                      │                      │
   │                      │ ── STEP 2: Validate ─┤                      │
   │                      │  Verify HMAC sig      │                      │
   │                      │  Check timestamp <1h  │                      │
   │                      │  Check currency=BOB   │                      │
   │                      │  Check balance >= 0   │                      │
   │                      │                      │                      │
   │                      │ ── STEP 3: Convert ──┤                      │
   │                      │  balance→uint256(18d) │                      │
   │                      │                      │                      │
   │                      │ ── STEP 4: Update ───┤                      │
   │                      │  updateReserves(      │                      │
   │                      │    totalReserves)     │                      │
   │                      │──────────────────────┼─────────────────────►│
   │                      │  ReservesUpdated      │                      │
   │                      │◄─────────────────────┼──────────────────────│
   │                      │                      │                      │
   │                      │  (if reserves <       │                      │
   │                      │   totalSupply)        │                      │
   │                      │  ReservesDeficit      │                      │
   │                      │  + mintPaused = true  │                      │
   │                      │                      │                      │
   ▼                      ▼                      ▼                      ▼
```

### Trigger

**Chainlink Automation (Keeper)** — time-based trigger every 24 hours.

This is configured via the Chainlink Automation dashboard or programmatically. The Automation contract calls a `checkUpkeep()` function that returns true when 24 hours have passed since the last update, then calls `performUpkeep()` which triggers Job 2.

Alternatively, the CRE can implement its own cron-like scheduler using Chainlink's time-based trigger.

### SLA

| Metric | Target |
|--------|--------|
| Time from trigger to onchain update | < 1 hour |
| Priority | Critical — failure pauses minting |
| Consecutive failures before auto-pause | 3 |

### Bank API request

```
GET /api/reserves
Authorization: Bearer {oauth_token}
```

### Bank API response format

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `accountId` | string | Custodial account ID | `"ACCT-001-CUSTODIA"` |
| `balance` | number | Current balance in Bolivianos (2 decimal places) | `5000000.00` |
| `currency` | string | Must be `"BOB"` | `"BOB"` |
| `timestamp` | string (ISO 8601) | When the bank calculated this balance | `"2026-03-04T00:00:00Z"` |

The response also includes `signature` (HMAC-SHA256) and `nonce` headers/fields.

### Step-by-step processing

#### Step 1: Fetch reserves from bank

Call `GET /api/reserves` with OAuth2 Bearer token. If the bank API is unreachable, retry according to the failure escalation table below.

#### Step 2: Validate bank response

| # | Check | Condition | If fails |
|---|-------|-----------|----------|
| 1 | HMAC signature | Valid HMAC-SHA256 | Reject with `INVALID_SIGNATURE`. Security alert. |
| 2 | Nonce | `nonce > lastSeenNonce` | Reject with `REPLAY_DETECTED`. |
| 3 | Timestamp freshness | `now() - timestamp < 1 hour` | Reject with `STALE_RESERVES`. The balance data is too old to be reliable for proof of reserves. |
| 4 | Currency | `currency == "BOB"` | Reject with `INVALID_CURRENCY`. |
| 5 | Balance | `balance >= 0` | Reject with `INVALID_BALANCE`. |

**Note:** The timestamp freshness for reserves is **1 hour** (stricter than the 24 hours for deposits). Proof of reserves requires recent data.

#### Step 3: Data conversion

| Source field | Transformation | Target field | Solidity type |
|-------------|----------------|-------------|---------------|
| `balance` (number, 2 decimals) | `Math.round(balance * 1e18)` | `totalReserves` | `uint256` |

Use `ethers.parseUnits(balance.toString(), 18)` to avoid floating point errors.

#### Step 4: Update reserves onchain

```
FiatDepositOracle.updateReserves(uint256 totalReserves)
```

- **Caller:** CRE wallet (must have `ORACLE_ROLE`)
- **Gas estimate:** ~60,000 gas
- **Wait for:** 1 block confirmation
- **Emits:** `ReservesUpdated(uint256 totalReserves, uint256 timestamp)`

**What happens inside `updateReserves()`:**
1. The contract stores the new reserves value
2. The contract compares `totalReserves` vs `StablecoinBOB.totalSupply()`
3. If `totalReserves >= totalSupply`: reserves are sufficient. If minting was paused due to previous deficit, it is **automatically unpaused**.
4. If `totalReserves < totalSupply`: emits `ReservesDeficit(totalReserves, totalSupply)`. Minting is **not paused on first deficit** — only after 3 consecutive failures to update.

### Failure escalation

| Consecutive failures | Action |
|---------------------|--------|
| 1 | Retry in 15 minutes |
| 2 | Retry in 1 hour. Send alert to admin. |
| 3+ | Send critical alert. The contract automatically sets `mintPaused = true` because reserves data is stale (>72 hours since last update). |

**To resume minting after a pause:**
1. Fix the bank API connectivity issue
2. Run Job 2 manually (or wait for next scheduled run)
3. If the updated `totalReserves >= totalSupply`, the contract automatically unpauses minting
4. If `totalReserves < totalSupply`, minting remains paused and admin must investigate the reserves deficit

---

## 6. Job 3: RedeemExecution

### Purpose

When a user burns BOB tokens to redeem Bolivianos, this job detects the onchain event, executes the bank transfer, and confirms the redemption onchain once the transfer completes.

### Flow diagram

```
  User          RedeemContract       CRE Job 3           Bank API          RedeemContract
   │                  │                  │                   │                   │
   │ requestRedeem()  │                  │                   │                   │
   │ (burns tokens)   │                  │                   │                   │
   │─────────────────►│                  │                   │                   │
   │                  │                  │                   │                   │
   │                  │ event:           │                   │                   │
   │                  │ RedeemRequested  │                   │                   │
   │                  │  (redeemId,      │                   │                   │
   │                  │   user, amount,  │                   │                   │
   │                  │   bankAccountId) │                   │                   │
   │                  │─────────────────►│                   │                   │
   │                  │                  │                   │                   │
   │                  │                  │ ── STEP 1: ──────┤                   │
   │                  │                  │  Parse event      │                   │
   │                  │                  │  Convert data     │                   │
   │                  │                  │                   │                   │
   │                  │                  │ ── STEP 2: ──────┤                   │
   │                  │                  │  POST /transfers  │                   │
   │                  │                  │─────────────────►│                   │
   │                  │                  │  INITIATED        │                   │
   │                  │                  │◄─────────────────│                   │
   │                  │                  │                   │                   │
   │                  │                  │ ── STEP 3: ──────┤                   │
   │                  │                  │  Poll status      │                   │
   │                  │                  │  (every 15 min)   │                   │
   │                  │                  │─────────────────►│                   │
   │                  │                  │  PROCESSING       │                   │
   │                  │                  │◄─────────────────│                   │
   │                  │                  │         ...       │                   │
   │                  │                  │─────────────────►│                   │
   │                  │                  │  COMPLETED        │                   │
   │                  │                  │◄─────────────────│                   │
   │                  │                  │                   │                   │
   │                  │                  │ ── STEP 4: ──────┤                   │
   │                  │                  │  confirmRedeem    │                   │
   │                  │                  │  Executed(id)     │                   │
   │                  │                  │──────────────────┼──────────────────►│
   │                  │                  │  RedeemCompleted  │                   │
   │                  │                  │◄─────────────────┼───────────────────│
   │                  │                  │                   │                   │
   ▼                  ▼                  ▼                   ▼                   ▼
```

### Trigger

**Onchain event listener.** The CRE subscribes to the `RedeemRequested` event on the RedeemContract:

```solidity
event RedeemRequested(
    bytes32 indexed redeemId,
    address indexed user,
    uint256 amount,
    string bankAccountId
);
```

Use `ethers.Contract.on("RedeemRequested", callback)` or poll logs with a filter. Process events in order (by block number, then log index).

### SLA

| Metric | Target |
|--------|--------|
| Time from event to bank transfer initiated | < 1 hour |
| Time from event to fiat received by user | < 48 hours (depends on bank) |
| Priority | High — user's tokens are already burned |

**Important:** When a user calls `requestRedeem()`, their tokens are burned IMMEDIATELY. The fiat transfer MUST happen. If the bank transfer fails, the user has lost their tokens without receiving fiat. This makes RedeemExecution the most critical job from a user trust perspective.

### Step-by-step processing

#### Step 1: Parse event and convert data

When a `RedeemRequested` event is detected, extract and convert the data:

| Event field | Type (Solidity) | Transformation | Target field | Target type |
|-------------|----------------|----------------|-------------|-------------|
| `redeemId` | `bytes32` | `ethers.hexlify(redeemId)` | `redeemId` | string (hex) |
| `user` | `address` | — (not sent to bank, used for logging) | — | — |
| `amount` | `uint256` (18 decimals) | `Number(ethers.formatUnits(amount, 18))` | `amount` | number (2 decimals) |
| `bankAccountId` | `string` | Direct | `bankAccountId` | string |

**Amount conversion detail:** The onchain amount is in wei (18 decimals). The bank expects Bolivianos with 2 decimal places. Convert: `amount / 1e18`. Example: `500000000000000000000` → `500.00`. Use `ethers.formatUnits(amount, 18)` and round to 2 decimal places.

#### Step 2: Execute bank transfer

```
POST /api/transfers
Authorization: Bearer {oauth_token}
Content-Type: application/json

{
  "redeemId": "0xabcd1234...",
  "bankAccountId": "ACCT-USR-789",
  "amount": 500.00,
  "currency": "BOB",
  "reference": "BOB-REDEEM-0xabcd1234"
}
```

| Field | Description |
|-------|-------------|
| `redeemId` | Hex string of the bytes32 from the event |
| `bankAccountId` | From the event (the user specified this when calling `requestRedeem`) |
| `amount` | Converted from uint256 to number with 2 decimal places |
| `currency` | Always `"BOB"` |
| `reference` | Human-readable reference including the redeemId for bank statement traceability |

**Expected response:**

```json
{
  "success": true,
  "transferId": "TRF-2026-00042",
  "status": "INITIATED",
  "estimatedCompletion": "2026-03-05T14:30:00Z"
}
```

Save the `transferId` — you will need it to poll for status.

#### Step 3: Poll for transfer completion

After the bank accepts the transfer, poll its status until it reaches a terminal state:

```
GET /api/transactions/{transferId}
Authorization: Bearer {oauth_token}
```

| Status | Terminal? | Action |
|--------|----------|--------|
| `PENDING` | No | Wait, poll again in 15 minutes |
| `PROCESSING` | No | Wait, poll again in 15 minutes |
| `COMPLETED` | Yes | Proceed to Step 4 (confirm onchain) |
| `FAILED` | Yes | Log failure reason. Alert admin. Create manual ticket. |
| `REVERSED` | Yes | Log. Alert admin. The bank reversed the transfer — manual resolution needed. |

**Polling interval:** Every 15 minutes.
**Maximum polling time:** 48 hours. If the transfer has not reached a terminal state after 48 hours, escalate to admin.

#### Step 4: Confirm redemption onchain

Once the bank transfer status is `COMPLETED`, confirm the redemption onchain:

```
RedeemContract.confirmRedeemExecuted(bytes32 redeemId)
```

- **Caller:** CRE wallet (must have `ORACLE_ROLE`)
- **Gas estimate:** ~60,000 gas
- **Wait for:** 1 block confirmation
- **Emits:** `RedeemCompleted(bytes32 indexed redeemId, address indexed user, uint256 amount)`

### Error handling

| Scenario | Action |
|----------|--------|
| Bank API returns HTTP 400 (INVALID_ACCOUNT) | Do NOT retry. Account may be closed. Create manual ticket. Alert admin immediately — user's tokens are burned. |
| Bank API returns HTTP 400 (INSUFFICIENT_FUNDS) | Critical alert — custodial account should always have funds. Alert admin immediately. |
| Bank API returns HTTP 409 (DUPLICATE_REDEEM) | Treat as success — transfer was already initiated. Proceed to polling. |
| Bank API returns HTTP 5xx | Retry up to 3 times with exponential backoff (30s, 2m, 10m). |
| Bank API timeout (>30s) | Retry once after 5 minutes. |
| All bank retries exhausted | Create manual ticket. Alert admin. Mark redeem as `PENDING_MANUAL`. Do NOT lose the event data. |
| Transfer status = FAILED | Alert admin. Create manual ticket. Include failure reason from bank. |
| Transfer status = REVERSED | Alert admin. Create manual ticket. Investigate with bank. |
| `confirmRedeemExecuted` reverts | See [Error Handling Reference](#9-error-handling-reference). |
| Transfer not completed after 48h | Escalate to admin. The user sees `PROCESSING` status. |

---

## 7. Contract Interfaces

### FiatDepositOracle.sol

The CRE's primary target contract. Receives deposit confirmations and reserve updates.

```solidity
// ═══════════════════════════════════════════════════
// State-changing functions (require ORACLE_ROLE)
// ═══════════════════════════════════════════════════

/// @notice Confirms a fiat deposit. Called by CRE after validating bank data.
/// @param txId keccak256 hash of the bank transaction ID string
/// @param userWallet The wallet address to receive minted tokens
/// @param amount Deposit amount in 18-decimal format (1 BOB = 1e18)
/// @dev Reverts if txId already processed, caller lacks ORACLE_ROLE, or mintPaused
function confirmDeposit(bytes32 txId, address userWallet, uint256 amount) external;

/// @notice Updates the onchain record of total fiat reserves.
/// @param totalReserves Current custodial balance in 18-decimal format
/// @dev If totalReserves < totalSupply, emits ReservesDeficit.
///      If totalReserves >= totalSupply and was previously in deficit, unpauses minting.
function updateReserves(uint256 totalReserves) external;

// ═══════════════════════════════════════════════════
// View functions (no role required)
// ═══════════════════════════════════════════════════

/// @notice Checks if a deposit transaction has already been processed
/// @param txId keccak256 hash of the bank transaction ID
/// @return true if the deposit was already confirmed
function isProcessed(bytes32 txId) external view returns (bool);

/// @notice Returns the details of a confirmed deposit
/// @return user The wallet address, amount The deposit amount, timestamp When it was confirmed
function getDeposit(bytes32 txId) external view returns (address user, uint256 amount, uint256 timestamp);

/// @notice Returns the last reported reserve balance
function reserves() external view returns (uint256);

/// @notice Returns whether minting is currently paused
function mintPaused() external view returns (bool);

// ═══════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════

event DepositConfirmed(bytes32 indexed txId, address indexed userWallet, uint256 amount);
event ReservesUpdated(uint256 totalReserves, uint256 timestamp);
event ReservesDeficit(uint256 totalReserves, uint256 totalSupply);
```

### MinterContract.sol

Mints StablecoinBOB tokens based on confirmed deposits.

```solidity
/// @notice Mints tokens for a confirmed deposit.
/// @param txId The deposit txId (must exist in FiatDepositOracle)
/// @dev Reads deposit data from FiatDepositOracle, then calls StablecoinBOB.mint().
///      StablecoinBOB's _beforeTokenTransfer hook checks PolicyManager for compliance.
///      Reverts if deposit not found, already minted, or compliance check fails.
function mint(bytes32 txId) external;

// Events
event TokensMinted(bytes32 indexed txId, address indexed userWallet, uint256 amount);
```

### RedeemContract.sol

Handles token redemption (burn → bank transfer → confirmation).

```solidity
/// @notice Confirms that the bank transfer for a redemption has been executed.
/// @param redeemId The redemption ID from the RedeemRequested event
/// @dev Reverts if redeemId not found or already confirmed.
function confirmRedeemExecuted(bytes32 redeemId) external;

// Events (the CRE listens to RedeemRequested, emits RedeemCompleted)
event RedeemRequested(bytes32 indexed redeemId, address indexed user, uint256 amount, string bankAccountId);
event RedeemCompleted(bytes32 indexed redeemId, address indexed user, uint256 amount);
```

### CCIDRegistry.sol (read only)

The CRE reads from this contract to verify user identity and resolve wallet addresses. The CRE does NOT write to this contract.

```solidity
/// @notice Checks if a user has a registered CCID (identity)
/// @param userId The user's bank system ID (e.g., "USR-BOL-12345")
/// @return true if the user has completed KYC and has a registered identity
function hasCCID(string calldata userId) external view returns (bool);

/// @notice Returns the wallet address associated with a user ID
/// @param userId The user's bank system ID
/// @return The user's wallet address on Base (or address(0) if not found)
function getWallet(string calldata userId) external view returns (address);
```

---

## 8. Security and Authentication

### CRE → Smart Contracts (onchain)

| Aspect | Implementation |
|--------|---------------|
| **Authentication** | The CRE wallet signs all transactions with its private key. The contracts verify the sender has `ORACLE_ROLE` via OpenZeppelin's AccessControl. |
| **Key storage** | The private key is stored in **Chainlink Secrets Manager** (encrypted, never in plaintext, never in environment variables in production). |
| **Key rotation** | If the key is compromised: (1) admin multisig revokes `ORACLE_ROLE` from old address, (2) generates new key, (3) grants `ORACLE_ROLE` to new address. |
| **Role scope** | `ORACLE_ROLE` only permits: `confirmDeposit()`, `updateReserves()`, `mint()`, `confirmRedeemExecuted()`. It cannot modify parameters, freeze wallets, or upgrade contracts. |

### Bank → CRE (verifying bank responses)

Every bank API response includes a signature that the CRE MUST verify:

```
Header: X-Bank-Signature: <signature>

Verification:
  expected = HMAC-SHA256(response_body_bytes, BANK_HMAC_SECRET)
  actual   = X-Bank-Signature header value

  if expected != actual → REJECT. Log as INVALID_SIGNATURE security alert.
```

| Aspect | Implementation |
|--------|---------------|
| **Algorithm** | HMAC-SHA256 |
| **Shared secret** | Stored in Chainlink Secrets Manager. Rotated every 90 days. |
| **What is signed** | The raw response body bytes (before JSON parsing) |
| **Failure action** | Reject the response. Do NOT process the data. Log as security alert. |

### CRE → Bank (authenticating requests)

| Aspect | Implementation |
|--------|---------------|
| **Protocol** | OAuth2 Client Credentials |
| **Token endpoint** | `POST /oauth/token` with `client_id` and `client_secret` |
| **Token TTL** | 1 hour. Request new token before expiry or on 401 response. |
| **Credentials storage** | `client_id` and `client_secret` in Chainlink Secrets Manager |
| **Transport** | HTTPS required. mTLS required in production. |

### Anti-replay protection

Two layers of anti-replay protection:

**Layer 1 — Bank nonce (offchain):**

Every bank response includes a `nonce` field — a monotonically increasing integer. The CRE must:

1. Track `lastSeenNonce` per endpoint in persistent storage
2. On each response: if `nonce <= lastSeenNonce` → reject with `REPLAY_DETECTED`
3. On success: update `lastSeenNonce = nonce`
4. This prevents replayed bank responses from being processed twice

**Layer 2 — Onchain deduplication:**

`FiatDepositOracle.isProcessed(txId)` returns true if a deposit was already confirmed. Even if the anti-replay nonce check is bypassed, the contract prevents double-processing.

### Additional safeguards

| Protection | Implementation | Configurable |
|-----------|----------------|-------------|
| Rate limiting | Max 100 deposits per hour | Yes (env var) |
| Circuit breaker | If >10 transactions fail in 1 hour, pause processing and alert | Yes |
| Maximum amount | Deposits > 100,000 BOB require manual approval (flagged, not auto-processed) | Yes |
| Timestamp validation | Deposits >24h old rejected. Reserves >1h old rejected. | Yes |
| Gas monitoring | Alert if wallet ETH balance < 0.01 ETH | Yes |

---

## 9. Error Handling Reference

### Error response format

When a job encounters an error, it should log it in this format:

```json
{
  "timestamp": "2026-03-04T14:30:00.123Z",
  "job": "FiatDepositConfirmation",
  "errorCode": "INVALID_SIGNATURE",
  "errorSource": "validation",
  "retryable": false,
  "message": "HMAC-SHA256 signature verification failed",
  "inputSummary": {
    "txId": "DEP-2026-00001",
    "amount": 1000.00
  },
  "action": "Rejected. Security alert sent."
}
```

### Validation errors (CRE-side, before any onchain call)

| Code | Job(s) | Description | Retryable | Action |
|------|--------|-------------|-----------|--------|
| `INVALID_SIGNATURE` | All | HMAC-SHA256 verification failed | No | Reject. Log as **security alert** — possible data tampering or misconfigured secret. |
| `REPLAY_DETECTED` | All | Nonce is not greater than last seen | No | Reject. Log as **security alert** — possible replay attack. |
| `STALE_DEPOSIT` | Job 1 | Deposit timestamp > 24 hours old | No | Reject. Log. The bank sent old data. |
| `STALE_RESERVES` | Job 2 | Reserves timestamp > 1 hour old | Yes | Retry after delay — bank may return fresher data. |
| `INVALID_AMOUNT` | Job 1 | Amount <= 0 | No | Reject. |
| `INVALID_BALANCE` | Job 2 | Balance < 0 | No | Reject. |
| `INVALID_CURRENCY` | All | Currency is not "BOB" | No | Reject. |
| `INVALID_TX_ID` | Job 1 | txId does not match expected pattern | No | Reject. |
| `NO_CCID` | Job 1 | User has no registered identity in CCIDRegistry | No | Reject. The user must complete KYC onboarding first. |
| `NO_WALLET` | Job 1 | CCIDRegistry returned address(0) for this user | No | Reject. Configuration error — user has CCID but no wallet. |
| `DUPLICATE_TX` | Job 1 | `isProcessed(txId)` returned true | No | Skip silently (idempotent). Log for monitoring. |
| `MINT_PAUSED` | Job 1 | `mintPaused()` returned true | No | Queue the deposit. Do not discard. Alert admin. |
| `AMOUNT_EXCEEDS_MAX` | Job 1 | Amount > configured maximum (100,000 BOB) | No | Flag for manual approval. Do not auto-process. |

### Contract revert errors (onchain)

When a transaction reverts, the CRE must parse the revert reason and act accordingly:

| Revert reason | Contract | Job(s) | Retryable | Action |
|--------------|----------|--------|-----------|--------|
| `"TxAlreadyProcessed"` | FiatDepositOracle | Job 1 | No | Already done. Treat as success (idempotent). |
| `"MintPaused"` | FiatDepositOracle | Job 1 | No | Reserves are stale. Wait until Job 2 updates reserves. |
| `"InvalidAmount"` | FiatDepositOracle | Job 1 | No | Amount is 0 or overflow. Check conversion logic. |
| `"DepositNotFound"` | MinterContract | Job 1 | No | `confirmDeposit` was not called first, or txId mismatch. |
| `"AlreadyMinted"` | MinterContract | Job 1 | No | Tokens already minted for this deposit. Treat as success. |
| `"TransferBlocked"` | StablecoinBOB (via MinterContract) | Job 1 | No | PolicyManager blocked the mint (user frozen, sanctioned, or limit exceeded). Log as `MINT_BLOCKED_BY_COMPLIANCE`. Alert admin. |
| `"RedeemNotFound"` | RedeemContract | Job 3 | No | Invalid redeemId. Check event parsing. |
| `"AlreadyConfirmed"` | RedeemContract | Job 3 | No | Redeem already confirmed. Treat as success. |
| `AccessControl: account 0x... is missing role 0x...` | Any | All | No | CRE wallet does not have `ORACLE_ROLE`. **Configuration error.** The admin multisig must grant the role. |

### Infrastructure errors

| Code | Source | Job(s) | Retryable | Action |
|------|--------|--------|-----------|--------|
| `INSUFFICIENT_GAS` | Wallet | All | No | CRE wallet ETH balance too low. Alert admin to fund the wallet. |
| `RPC_UNAVAILABLE` | RPC endpoint | All | Yes | Try fallback RPC endpoint. If all fail, alert admin. |
| `NONCE_TOO_LOW` | Transaction | All | Yes | Re-fetch nonce from RPC and retry once. |
| `TX_TIMEOUT` | Transaction | All | Yes | Transaction sent but not confirmed within 5 minutes. Check if pending. Do NOT re-send (risk of duplicate). Wait for pending tx. |
| `BANK_API_UNAVAILABLE` | Bank API | Job 2, 3 | Yes | Retry with exponential backoff. |
| `BANK_AUTH_FAILED` | Bank API | Job 2, 3 | Yes | OAuth token expired. Refresh token and retry. |
| `BANK_RATE_LIMITED` | Bank API | Job 2, 3 | Yes | Respect `Retry-After` header. |

### Global retry strategy

```yaml
retry_policy:
  max_attempts: 3
  backoff: exponential
  initial_delay: 30s
  multiplier: 4
  max_delay: 10m

  retryable:
    - RPC_UNAVAILABLE
    - NONCE_TOO_LOW
    - TX_TIMEOUT
    - BANK_API_UNAVAILABLE
    - BANK_AUTH_FAILED
    - BANK_RATE_LIMITED
    - STALE_RESERVES  # bank may return fresher data on retry

  non_retryable:
    - INVALID_SIGNATURE
    - REPLAY_DETECTED
    - NO_CCID
    - DUPLICATE_TX
    - MINT_PAUSED
    - INVALID_AMOUNT
    - INVALID_CURRENCY
    - INSUFFICIENT_GAS
    - AccessControl errors
    - All "Already*" revert reasons (idempotent)
    - TransferBlocked (compliance)
```

---

## 10. Setup and Configuration

### Environment Variables

```bash
# ════════════════════════════════════════════════════
# Bank API Configuration
# ════════════════════════════════════════════════════

# Bank API base URL
BANK_API_URL=https://sandbox.banco-bol.example/api/v1

# OAuth2 credentials (stored in Chainlink Secrets Manager in production)
BANK_OAUTH_TOKEN_URL=https://sandbox.banco-bol.example/oauth/token
BANK_OAUTH_CLIENT_ID=cre-oracle-client
BANK_OAUTH_CLIENT_SECRET=<secret>

# HMAC shared secret for verifying bank signatures
BANK_HMAC_SECRET=<shared-secret>

# Bank API request timeout (ms)
BANK_API_TIMEOUT=30000

# ════════════════════════════════════════════════════
# Blockchain Configuration
# ════════════════════════════════════════════════════

# Base RPC endpoint (primary)
BASE_RPC_URL=https://sepolia.base.org

# Base RPC endpoint (fallback, used when primary fails)
BASE_RPC_URL_FALLBACK=https://base-sepolia.g.alchemy.com/v2/<key>

# CRE wallet private key (ORACLE_ROLE)
# In production: stored in Chainlink Secrets Manager, NEVER in env vars
CRE_WALLET_PRIVATE_KEY=<private-key>

# Chain ID
BASE_CHAIN_ID=84532  # Base Sepolia (testnet)

# ════════════════════════════════════════════════════
# Contract Addresses (provided after deployment)
# ════════════════════════════════════════════════════

CONTRACT_FIAT_DEPOSIT_ORACLE=0x...
CONTRACT_MINTER=0x...
CONTRACT_REDEEM=0x...
CONTRACT_CCID_REGISTRY=0x...

# ════════════════════════════════════════════════════
# Job Configuration
# ════════════════════════════════════════════════════

# Job 1: Deposit confirmation
DEPOSIT_POLLING_INTERVAL_MS=300000      # 5 minutes (polling fallback)
DEPOSIT_WEBHOOK_PORT=8080               # Webhook listener port
DEPOSIT_MAX_AGE_HOURS=24                # Max age of deposit timestamp
DEPOSIT_MAX_AMOUNT=100000               # Max auto-processed amount (BOB)

# Job 2: Proof of Reserves
RESERVES_INTERVAL_HOURS=24              # How often to check reserves
RESERVES_MAX_AGE_HOURS=1                # Max age of reserves timestamp
RESERVES_MAX_CONSECUTIVE_FAILURES=3     # Failures before mint pause

# Job 3: Redeem execution
REDEEM_POLL_INTERVAL_MS=900000          # 15 minutes (bank transfer status)
REDEEM_MAX_WAIT_HOURS=48                # Max time to wait for transfer
REDEEM_EVENT_POLL_INTERVAL_MS=15000     # 15 seconds (event listener)

# ════════════════════════════════════════════════════
# Operational
# ════════════════════════════════════════════════════

# Rate limiting
MAX_DEPOSITS_PER_HOUR=100
CIRCUIT_BREAKER_FAILURE_THRESHOLD=10    # Failures per hour to trigger pause

# Alerting (webhook URL for alerts)
ALERT_WEBHOOK_URL=https://hooks.slack.example/alert

# Log level
LOG_LEVEL=info

# Nonce tracking storage (persistent)
NONCE_STORAGE_PATH=/var/lib/cre/nonce.json

# Audit log path
AUDIT_LOG_PATH=/var/log/cre/audit.jsonl
```

### Contract ABIs

Place the following ABI files in the CRE configuration directory:

```
abi/FiatDepositOracle.json
abi/MinterContract.json
abi/RedeemContract.json
abi/CCIDRegistry.json
```

These will be provided after contract compilation and deployment.

### Chainlink Automation Setup (Job 2 trigger)

Job 2 (ProofOfReserves) uses Chainlink Automation for its time-based trigger. Setup steps:

1. Deploy an Automation-compatible contract or use Chainlink's time-based trigger
2. Register the upkeep on the Chainlink Automation dashboard:
   - **Network:** Base Sepolia (testnet) or Base Mainnet
   - **Trigger type:** Time-based
   - **Interval:** 24 hours (86400 seconds)
   - **Target:** The CRE's performUpkeep function or equivalent
3. Fund the upkeep with LINK tokens
4. Verify the first execution fires correctly

### Webhook Setup (Job 1 trigger)

If using webhook mode for Job 1:

1. Expose an HTTPS endpoint at `https://<cre-host>:<DEPOSIT_WEBHOOK_PORT>/deposit`
2. The bank will POST deposit notifications to this endpoint
3. Ensure the endpoint is firewalled — only the bank's IP addresses should be allowed
4. TLS certificate required (the bank will verify it)
5. Register the webhook URL with the bank

### Wallet Setup

1. Generate a dedicated wallet for the CRE (NOT shared with the MCP server — they have different roles)
2. Fund with ETH on Base for gas:
   - Testnet: Use Base Sepolia faucet
   - Production: Recommended initial balance 0.1 ETH. Monitor and top up when < 0.01 ETH.
3. Request the admin multisig to grant `ORACLE_ROLE` on:
   - FiatDepositOracle
   - MinterContract
   - RedeemContract
4. Verify: call `hasRole(ORACLE_ROLE, cre_wallet_address)` on each contract — must return true

### Health Check

Implement a health check that verifies:

| Check | Method | Alert if |
|-------|--------|----------|
| Bank API reachable | `GET /health` or `HEAD /api/reserves` | Unreachable for > 5 minutes |
| RPC endpoint reachable | `eth_blockNumber` | Unreachable for > 1 minute |
| Wallet has gas | `eth_getBalance(cre_wallet)` | Balance < 0.01 ETH |
| ORACLE_ROLE active | `hasRole()` on all 3 contracts | Any returns false |
| OAuth token valid | Test with a read-only endpoint | 401 response |
| Last reserves update | `FiatDepositOracle.lastUpdateTimestamp()` | > 25 hours ago |
| Nonce file writable | Write test to nonce storage | Not writable |

---

## 11. Environments

### Testnet (Base Sepolia)

| Setting | Value |
|---------|-------|
| **Chain** | Base Sepolia (chain ID: 84532) |
| **Bank API** | Sandbox (`sandbox.banco-bol.example`) |
| **Bank behavior** | Deposits confirm instantly. Transfers complete in 30 seconds. No nonce validation. |
| **HMAC secret** | Test secret (can be hardcoded in config for convenience) |
| **CRE wallet** | Testnet wallet funded with faucet ETH |
| **Polling intervals** | Aggressive: deposit polling 1 min, reserves check every 1 hour |
| **Amount limits** | None (test freely with any amounts) |
| **Nonce validation** | Disabled (sandbox does not implement nonces) |
| **mTLS** | Not required |

### Production (Base Mainnet)

| Setting | Value |
|---------|-------|
| **Chain** | Base Mainnet (chain ID: 8453) |
| **Bank API** | Production (`api.banco-bol.example`) |
| **Bank behavior** | Real banking operations. Transfers take hours to days. |
| **HMAC secret** | Production secret in Chainlink Secrets Manager. Rotated every 90 days. |
| **CRE wallet** | Production wallet. Private key in Chainlink Secrets Manager. |
| **Polling intervals** | Standard: deposit polling 5 min, reserves check every 24 hours |
| **Amount limits** | Deposits > 100,000 BOB flagged for manual approval |
| **Nonce validation** | Enabled |
| **mTLS** | Required — the CRE must present a client certificate to the bank API |

### Migration checklist (testnet → production)

- [ ] Deploy contracts on Base Mainnet
- [ ] Admin multisig grants `ORACLE_ROLE` to CRE production wallet
- [ ] Verify `ORACLE_ROLE` is active on all 3 contracts
- [ ] Store private key in Chainlink Secrets Manager (remove from env vars)
- [ ] Store HMAC secret in Chainlink Secrets Manager
- [ ] Store OAuth credentials in Chainlink Secrets Manager
- [ ] Update all contract addresses in configuration
- [ ] Switch `BASE_RPC_URL` to mainnet endpoint
- [ ] Switch `BANK_API_URL` to production endpoint
- [ ] Configure mTLS certificate for bank API
- [ ] Register webhook URL with production bank
- [ ] Set up Chainlink Automation on Base Mainnet with LINK funding
- [ ] Run test deposit with minimum amount (1 BOB)
- [ ] Run test redemption with minimum amount (1 BOB)
- [ ] Verify ProofOfReserves fires and reports correctly
- [ ] Configure production alerting (Slack, PagerDuty, etc.)
- [ ] Document runbook for operations team
- [ ] Set up gas monitoring and auto-top-up for CRE wallet

---

## 12. Monitoring and Logging

### Audit logging

Every job execution must generate an audit log entry. This is a **regulatory requirement** — Bolivia's financial regulations require 5-year retention.

#### Log entry format

```json
{
  "timestamp": "2026-03-04T14:30:00.123Z",
  "job": "FiatDepositConfirmation",
  "jobExecutionId": "exec-2026-00001",
  "trigger": "webhook",
  "input": {
    "txId": "DEP-2026-00001",
    "amount": 1000.00,
    "userId": "USR-BOL-12345"
  },
  "validations": {
    "hmacValid": true,
    "timestampValid": true,
    "amountValid": true,
    "currencyValid": true,
    "ccidExists": true,
    "notDuplicate": true
  },
  "conversions": {
    "txIdBytes32": "0xabc123...",
    "walletAddress": "0x742d...",
    "amountUint256": "1000000000000000000000"
  },
  "onchainTx": {
    "confirmDeposit": {
      "txHash": "0x9876...",
      "gasUsed": 78500,
      "status": "success"
    },
    "mint": {
      "txHash": "0xfedc...",
      "gasUsed": 115000,
      "status": "success"
    }
  },
  "result": "SUCCESS",
  "durationMs": 12340
}
```

#### What to log per job

| Job | Log fields |
|-----|-----------|
| Job 1 | txId, userId, amount, all validation results, both tx hashes, mint success/failure |
| Job 2 | bank balance, converted amount, tx hash, reserves vs totalSupply comparison |
| Job 3 | redeemId, user address, amount, bank transferId, transfer status, confirmation tx hash |

### Key metrics to monitor

| Metric | Alert threshold | Job |
|--------|----------------|-----|
| Deposit confirmation latency | > 10 minutes | Job 1 |
| Reserves update age | > 25 hours | Job 2 |
| Consecutive reserves failures | >= 3 | Job 2 |
| Redeem transfer completion time | > 48 hours | Job 3 |
| CRE wallet ETH balance | < 0.01 ETH | All |
| Failed transactions per hour | > 10 | All |
| HMAC signature failures | Any | All |
| Replay attempts detected | Any | All |

### Storage

- **Format:** JSONL (one JSON object per line)
- **Rotation:** Daily, with gzip compression of older files
- **Retention:** Minimum 5 years (regulatory requirement)
- **Sensitive data:** NEVER log private keys, OAuth tokens, HMAC secrets. Use hashed/masked values for bank account numbers.
- **Nonce tracking:** Persist `lastSeenNonce` to disk — must survive process restarts. Use `NONCE_STORAGE_PATH`.
