# Bank API MCP Specification — BOB Stablecoin Agent

> **Version:** 1.0
> **Date:** 2026-03-04
> **Audience:** External development team implementing the MCP server
> **Status:** Production specification

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Architecture](#2-system-architecture)
3. [What the MCP Does and Does NOT Do](#3-what-the-mcp-does-and-does-not-do)
4. [Tool Summary](#4-tool-summary)
5. [Bank API Tools (Offchain)](#5-bank-api-tools-offchain)
6. [Contract Admin Tools (Onchain)](#6-contract-admin-tools-onchain)
7. [Roles and Governance](#7-roles-and-governance)
8. [End-to-End Flows](#8-end-to-end-flows)
9. [Setup and Configuration](#9-setup-and-configuration)
10. [Error Handling Reference](#10-error-handling-reference)
11. [Rate Limits](#11-rate-limits)
12. [Authentication](#12-authentication)
13. [Environments](#13-environments)
14. [Audit Logging](#14-audit-logging)

---

## 1. Introduction

### What is BOB Stablecoin?

BOB Stablecoin is an ERC-20 token on the Base blockchain (Coinbase L2) pegged 1:1 to the Bolivian Boliviano (BOB). It is backed by fiat reserves held in a custodial bank account in Bolivia. Users deposit Bolivianos at the bank and receive tokens; they can burn tokens to redeem Bolivianos back to their bank account.

### What is the AI Agent?

An AI agent (powered by Claude) operates as the system's day-to-day operator. It bridges the gap between the traditional banking system and the blockchain. The agent:

- Monitors bank deposits and triggers token minting
- Executes bank transfers when users redeem tokens
- Manages user identity registration (KYC onboarding)
- Enforces compliance actions (freeze wallets, file regulatory reports)
- Reports proof of reserves every 24 hours

The agent does NOT have unlimited power. It operates under two restricted roles (`REGISTRAR_ROLE` and `OPERATOR_ROLE`) and cannot modify system parameters, upgrade contracts, or remove sanctions. Those actions require a human multisig (Gnosis Safe, 3/5 signatures).

### What is the MCP?

MCP (Model Context Protocol) is the interface through which the AI agent accesses external capabilities. In this system, the MCP server exposes **14 tools** that the agent can call. These tools fall into two categories:

1. **Bank API tools (8 tools):** Call the bank's REST API to query balances, confirm deposits, execute transfers, and generate compliance reports. These are offchain operations.

2. **Contract admin tools (6 tools):** Send transactions to smart contracts on Base to register identities, link bank accounts, and enforce compliance. These are onchain operations that require the agent's wallet to hold the appropriate role.

### What are you building?

You are building the **MCP server** — the middleware layer between the AI agent and both the bank API and the smart contracts. Specifically:

```
┌──────────────┐                    ┌──────────────────────────────────────┐
│              │   MCP Protocol     │           MCP SERVER                 │
│  AI Agent    │   (tool calls)     │         (you build this)             │
│  (Claude)    │ ──────────────────►│                                      │
│              │ ◄──────────────────│  ┌─────────────┐  ┌──────────────┐  │
│              │   (tool results)   │  │ Bank API    │  │ Contract     │  │
└──────────────┘                    │  │ Client      │  │ Client       │  │
                                    │  │ (REST/OAuth) │  │ (ethers.js)  │  │
                                    │  └──────┬──────┘  └──────┬───────┘  │
                                    │         │                │          │
                                    └─────────┼────────────────┼──────────┘
                                              │                │
                                    ┌─────────▼──────┐  ┌──────▼───────────┐
                                    │  Banco BOL     │  │  Base Blockchain  │
                                    │  REST API      │  │  (Smart Contracts)│
                                    │  (HTTPS/mTLS)  │  │                   │
                                    └────────────────┘  └───────────────────┘
```

Your MCP server must:
- Implement all 14 tools following the JSON schemas in this document
- Handle authentication to both the bank API (OAuth2) and the blockchain (private key)
- Validate inputs before forwarding to the bank or sending transactions
- Handle errors gracefully and return structured error responses
- Log every operation for audit compliance

### What is the CRE?

Chainlink CRE (Compute Runtime Environment) is a separate system that handles the **automated onchain operations**:
- Confirming deposits onchain (`FiatDepositOracle.confirmDeposit`)
- Minting tokens (`MinterContract.mint`)
- Updating reserves (`FiatDepositOracle.updateReserves`)
- Confirming redemption execution (`RedeemContract.confirmRedeemExecuted`)

The CRE is documented separately in `CRE_SPEC.md`. Your MCP server does NOT need to implement CRE functionality. The MCP and CRE are complementary systems that share data but operate independently.

### Smart Contracts

The following contracts are deployed on Base. Your MCP server interacts with 3 of them:

| Contract | Address | MCP Interacts? | Purpose |
|----------|---------|----------------|---------|
| `StablecoinBOB` | (provided at deploy) | No | ERC-20 token with compliance hooks |
| `FiatDepositOracle` | (provided at deploy) | No | Receives oracle data from CRE |
| `MinterContract` | (provided at deploy) | No | Mints tokens (CRE calls this) |
| `RedeemContract` | (provided at deploy) | **Yes** | `linkBankAccount()` — called by MCP |
| `PolicyManager` | (provided at deploy) | **Yes** | `freezeWallet()`, `unfreezeWallet()`, `addToSanctions()` — called by MCP |
| `CCIDRegistry` | (provided at deploy) | **Yes** | `registerIdentity()`, `revokeIdentity()` — called by MCP |

Contract ABIs will be provided separately. The MCP server's wallet must hold `REGISTRAR_ROLE` on CCIDRegistry and `OPERATOR_ROLE` on PolicyManager and RedeemContract. These roles are granted by the admin multisig during deployment.

---

## 2. System Architecture

### Complete system overview

```
                                    OFFCHAIN                              ONCHAIN (Base)

  ┌──────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────────────────────────┐
  │  Bank    │    │  MCP Server │    │  Chainlink   │    │  Smart Contracts             │
  │  (API)   │◄──►│  (you)      │    │  CRE         │    │                              │
  │          │    │             │    │              │    │  CCIDRegistry                │
  │  OAuth2  │    │  14 tools   │    │  3 jobs      │    │  PolicyManager               │
  │  HMAC    │    │             │    │              │    │  FiatDepositOracle           │
  └──────────┘    └──────┬──────┘    └──────┬───────┘    │  MinterContract              │
                         │                  │            │  RedeemContract               │
                         │                  │            │  StablecoinBOB               │
                         │                  │            └──────────────────────────────┘
                         │                  │                         ▲
                         │                  │                         │
                         └──────────────────┴─────────────────────────┘
                              Both send transactions to contracts
                              MCP: REGISTRAR_ROLE + OPERATOR_ROLE
                              CRE: ORACLE_ROLE
```

### Data flow for key operations

**Deposit (fiat → token):**
```
Bank → (webhook) → MCP:confirm_deposit → (data) → CRE:FiatDepositConfirmation → FiatDepositOracle.confirmDeposit() → MinterContract.mint() → StablecoinBOB
```

**Redeem (token → fiat):**
```
User → RedeemContract.requestRedeem() → (event) → CRE:RedeemExecution → MCP:execute_bank_transfer → Bank → (status) → MCP:get_transaction_status → CRE → RedeemContract.confirmRedeemExecuted()
```

**Onboarding:**
```
Bank KYC → MCP:register_identity → CCIDRegistry → MCP:link_bank_account → RedeemContract → MCP:link_wallet_to_account → Bank
```

---

## 3. What the MCP Does and Does NOT Do

### What the MCP DOES

| Responsibility | Tools involved |
|---------------|----------------|
| Confirm bank deposits to enable minting | `confirm_deposit` |
| Report custodial reserve balance | `get_reserves_balance` |
| Execute bank transfers for redemptions | `execute_bank_transfer` |
| Monitor transaction status | `get_transaction_status` |
| Verify bank account ownership | `verify_account_ownership` |
| Link wallets to bank accounts (offchain) | `link_wallet_to_account` |
| Generate UIF regulatory reports | `generate_uif_report` |
| Query account transaction history | `get_account_history` |
| Register user identity onchain | `register_identity` |
| Revoke user identity onchain | `revoke_identity` |
| Link wallet to bank account onchain | `link_bank_account` |
| Freeze wallets for compliance | `freeze_wallet` |
| Unfreeze wallets after resolution | `unfreeze_wallet` |
| Add wallets to sanctions list | `add_to_sanctions` |

### What the MCP does NOT do

These operations are handled by other components. Do NOT implement them in the MCP:

| Operation | Handled by | Why not MCP |
|-----------|-----------|-------------|
| Mint tokens | Chainlink CRE → MinterContract | Minting is automated by the oracle after deposit confirmation. The agent does not mint directly. |
| Burn tokens | User → RedeemContract | Users burn tokens themselves when requesting redemption. |
| Confirm deposit onchain | Chainlink CRE → FiatDepositOracle | The CRE handles onchain confirmation after the MCP provides bank data. |
| Update reserves onchain | Chainlink CRE → FiatDepositOracle | The CRE reads from `get_reserves_balance` and writes onchain. |
| Confirm redeem execution onchain | Chainlink CRE → RedeemContract | The CRE confirms the transfer completed. |
| Transfer tokens between users | Users directly | Standard ERC-20 transfers. |
| Change system parameters | Multisig (ADMIN_ROLE) | Fees, limits, thresholds — all require human multisig. |
| Remove sanctions | Multisig (ADMIN_ROLE) | Sanctions removal is intentionally excluded from agent capabilities. |
| Upgrade contracts | Multisig (ADMIN_ROLE) | Only the admin multisig can upgrade contracts. |

**Key principle:** The MCP provides DATA to the CRE (via `confirm_deposit` and `get_reserves_balance`) and EXECUTES bank transfers (via `execute_bank_transfer`). The CRE handles all token minting and onchain state updates. The MCP handles identity registration and compliance enforcement onchain.

---

## 4. Tool Summary

### All 14 tools at a glance

| # | Tool | Category | Target | Description |
|---|------|----------|--------|-------------|
| 1 | `confirm_deposit` | Bank API | Bank REST | Confirm a fiat deposit received |
| 2 | `get_reserves_balance` | Bank API | Bank REST | Get custodial account balance |
| 3 | `execute_bank_transfer` | Bank API | Bank REST | Execute outgoing bank transfer (redeem) |
| 4 | `get_transaction_status` | Bank API | Bank REST | Check status of a bank transaction |
| 5 | `verify_account_ownership` | Bank API | Bank REST | Verify a bank account belongs to a user |
| 6 | `link_wallet_to_account` | Bank API | Bank REST | Link wallet to bank account (offchain record) |
| 7 | `generate_uif_report` | Bank API | Bank REST | File suspicious activity report with UIF |
| 8 | `get_account_history` | Bank API | Bank REST | Get transaction history for an account |
| 9 | `register_identity` | Onchain | CCIDRegistry | Register a KYC-verified identity |
| 10 | `revoke_identity` | Onchain | CCIDRegistry | Revoke user identity |
| 11 | `link_bank_account` | Onchain | RedeemContract | Link wallet to bank account (onchain record) |
| 12 | `freeze_wallet` | Onchain | PolicyManager | Freeze wallet (block all operations) |
| 13 | `unfreeze_wallet` | Onchain | PolicyManager | Unfreeze wallet after resolution |
| 14 | `add_to_sanctions` | Onchain | PolicyManager | Add wallet to sanctions list (irreversible without multisig) |

### Dual registration: `link_wallet_to_account` vs `link_bank_account`

These two tools serve different purposes and BOTH must be called during onboarding:

| Tool | Where it writes | Purpose |
|------|----------------|---------|
| `link_wallet_to_account` (#6) | Bank database (offchain) | Tells the bank "this wallet belongs to this bank account" so the bank can process redemptions |
| `link_bank_account` (#11) | RedeemContract (onchain) | Tells the smart contract "this wallet can redeem to this bank account" so the contract allows redemption requests |

---

## 5. Bank API Tools (Offchain)

These tools call the bank's REST API. They do NOT send blockchain transactions.

### 5.1. `confirm_deposit`

Confirms and records an incoming fiat deposit. Called when the bank notifies that it received funds from a user.

**When to use:** When the bank sends a webhook notification or when polling detects a new pending deposit. This is the first step of the mint flow — without this confirmation, the CRE cannot mint tokens.

**Pre-validations the MCP server MUST perform before calling the bank API:**
1. `txId` matches pattern `^DEP-\d{4}-\d{5,}$`
2. `amount > 0`
3. `currency == "BOB"`
4. `userId` is not empty
5. `bankAccountId` is not empty

**What to do if the bank API call fails:**
- HTTP 4xx: Return the error to the agent. Do not retry (client error).
- HTTP 5xx: Retry up to 3 times with exponential backoff (1s, 5s, 15s). If all retries fail, return error `BANK_SERVICE_UNAVAILABLE`.
- Timeout (>30s): Retry once. If it fails again, return error `BANK_TIMEOUT`.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "txId": {
      "type": "string",
      "description": "Unique bank transaction ID. Format: DEP-YYYY-NNNNN",
      "pattern": "^DEP-\\d{4}-\\d{5,}$"
    },
    "userId": {
      "type": "string",
      "description": "User ID in the bank system. Format: USR-BOL-NNNNN"
    },
    "amount": {
      "type": "number",
      "description": "Deposit amount in Bolivianos (BOB). Two decimal places.",
      "minimum": 0.01
    },
    "currency": {
      "type": "string",
      "enum": ["BOB"],
      "description": "Must always be BOB (Bolivian Boliviano)"
    },
    "bankAccountId": {
      "type": "string",
      "description": "Source bank account ID. Format: ACCT-*"
    }
  },
  "required": ["txId", "userId", "amount", "currency", "bankAccountId"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "depositId": { "type": "string", "description": "Same as txId, echoed back for confirmation" },
    "status": {
      "type": "string",
      "enum": ["CONFIRMED", "ALREADY_PROCESSED", "REJECTED"],
      "description": "CONFIRMED = new deposit confirmed. ALREADY_PROCESSED = idempotent duplicate. REJECTED = bank refused."
    },
    "timestamp": { "type": "string", "format": "date-time" },
    "signature": { "type": "string", "description": "HMAC-SHA256 signature of the response body. Verify with shared secret." },
    "nonce": { "type": "integer", "description": "Monotonically increasing. Reject if <= last seen nonce." }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `INVALID_TX_ID` | 400 | txId format not recognized | Fix txId and retry |
| `USER_NOT_FOUND` | 404 | userId does not exist in bank | Check userId mapping |
| `DUPLICATE_DEPOSIT` | 409 | Deposit already confirmed | No action needed (idempotent) |
| `ACCOUNT_FROZEN` | 403 | Source bank account is frozen | Notify compliance team |
| `AMOUNT_EXCEEDS_LIMIT` | 400 | Amount exceeds daily deposit limit | Inform user of limit |
| `BANK_SERVICE_UNAVAILABLE` | 503 | Bank core system down | Retry later |

#### Example

**Request:**
```json
{
  "tool": "confirm_deposit",
  "arguments": {
    "txId": "DEP-2026-00001",
    "userId": "USR-BOL-12345",
    "amount": 1000.00,
    "currency": "BOB",
    "bankAccountId": "ACCT-USR-789"
  }
}
```

**Response:**
```json
{
  "success": true,
  "depositId": "DEP-2026-00001",
  "status": "CONFIRMED",
  "timestamp": "2026-03-04T14:30:00Z",
  "signature": "a1b2c3d4e5f6...",
  "nonce": 100042
}
```

---

### 5.2. `get_reserves_balance`

Gets the current balance of the custodial bank account that backs all BOB tokens. This balance must always be >= the total supply of tokens onchain.

**When to use:** Every 24 hours for the Proof of Reserves job, or on-demand for ad-hoc verification. The CRE reads this data and writes it onchain.

**Pre-validations:** None required. The accountId defaults to the custodial account.

**What to do if the bank API call fails:**
- HTTP 5xx: Retry up to 3 times with backoff. Critical: if this tool fails repeatedly, proof of reserves cannot be updated and minting will be paused automatically by the smart contract.
- Timeout: Retry once, then return error.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "Custodial account ID. Defaults to the main custody account.",
      "default": "ACCT-001-CUSTODIA"
    }
  },
  "required": []
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "accountId": { "type": "string" },
    "balance": { "type": "number", "description": "Current balance in BOB (Bolivianos)" },
    "currency": { "type": "string", "enum": ["BOB"] },
    "timestamp": { "type": "string", "format": "date-time", "description": "When the bank calculated this balance" },
    "signature": { "type": "string", "description": "HMAC-SHA256 of response body" },
    "nonce": { "type": "integer" }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `ACCOUNT_NOT_FOUND` | 404 | Custodial account does not exist | Configuration error — escalate |
| `SERVICE_UNAVAILABLE` | 503 | Bank core system down | Retry. If persists, alert admin (minting will be paused). |

#### Example

**Request:**
```json
{
  "tool": "get_reserves_balance",
  "arguments": {
    "accountId": "ACCT-001-CUSTODIA"
  }
}
```

**Response:**
```json
{
  "accountId": "ACCT-001-CUSTODIA",
  "balance": 5000000.00,
  "currency": "BOB",
  "timestamp": "2026-03-04T00:00:00Z",
  "signature": "f6e5d4c3b2a1...",
  "nonce": 100043
}
```

---

### 5.3. `execute_bank_transfer`

Executes an outgoing bank transfer to send Bolivianos to a user's bank account. This is the fiat leg of the token redemption process.

**When to use:** When the CRE detects a `RedeemRequested` event onchain and the tokens have already been burned. The CRE triggers this tool via the agent.

**Pre-validations the MCP server MUST perform:**
1. `redeemId` is not empty
2. `amount > 0`
3. `currency == "BOB"`
4. `bankAccountId` is not empty
5. Check that `redeemId` has not been processed before (keep local cache of processed redeemIds)

**What to do if the bank API call fails:**
- HTTP 400 (INVALID_ACCOUNT): Do NOT retry. Return error. The bank account may have been closed.
- HTTP 409 (DUPLICATE_REDEEM): Return success — the transfer was already initiated (idempotent).
- HTTP 5xx: Retry up to 3 times with exponential backoff.
- If all retries fail: Return error `BANK_SERVICE_UNAVAILABLE`. The agent will escalate. The user's tokens are already burned, so this MUST be resolved.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "redeemId": {
      "type": "string",
      "description": "Redemption ID. Hex string of the bytes32 from the onchain RedeemRequested event."
    },
    "bankAccountId": {
      "type": "string",
      "description": "Destination bank account ID for the user"
    },
    "amount": {
      "type": "number",
      "description": "Amount to transfer in BOB (Bolivianos). Already converted from uint256 (divided by 1e18).",
      "minimum": 0.01
    },
    "currency": {
      "type": "string",
      "enum": ["BOB"]
    },
    "reference": {
      "type": "string",
      "description": "Reference string for the bank. Should include the onchain transaction hash for traceability."
    }
  },
  "required": ["redeemId", "bankAccountId", "amount", "currency"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "transferId": { "type": "string", "description": "Bank's internal transfer ID. Use this with get_transaction_status." },
    "status": {
      "type": "string",
      "enum": ["INITIATED", "PROCESSING", "COMPLETED", "FAILED"],
      "description": "INITIATED = bank accepted the request. Monitor with get_transaction_status."
    },
    "estimatedCompletion": { "type": "string", "format": "date-time" },
    "signature": { "type": "string" },
    "nonce": { "type": "integer" }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `INVALID_ACCOUNT` | 400 | Destination account invalid or closed | Escalate — tokens already burned |
| `INSUFFICIENT_FUNDS` | 400 | Custodial account has insufficient funds | Critical alert — reserves mismatch |
| `DUPLICATE_REDEEM` | 409 | redeemId already processed | Treat as success (idempotent) |
| `TRANSFER_LIMIT_EXCEEDED` | 400 | Exceeds daily transfer limit | Queue for next day or split |
| `ACCOUNT_FROZEN` | 403 | Destination account frozen | Escalate to compliance |

#### Example

**Request:**
```json
{
  "tool": "execute_bank_transfer",
  "arguments": {
    "redeemId": "0x1234abcd5678ef901234abcd5678ef901234abcd5678ef901234abcd5678ef90",
    "bankAccountId": "ACCT-USR-789",
    "amount": 500.00,
    "currency": "BOB",
    "reference": "BOB-REDEEM-0x1234abcd"
  }
}
```

**Response:**
```json
{
  "success": true,
  "transferId": "TRF-2026-00042",
  "status": "INITIATED",
  "estimatedCompletion": "2026-03-05T14:30:00Z",
  "signature": "c3d4e5f6a1b2...",
  "nonce": 100044
}
```

---

### 5.4. `get_transaction_status`

Queries the current status of a bank transaction (deposit or transfer).

**When to use:** To poll the status of a bank transfer after calling `execute_bank_transfer`, or to check if a deposit has cleared. Typically polled every 5-15 minutes until the transaction reaches a terminal state (COMPLETED or FAILED).

**Pre-validations:** `transactionId` must not be empty.

**What to do if the bank API call fails:** Retry on 5xx. On 404, the transaction may not exist yet (race condition) — retry after 1 minute.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "transactionId": {
      "type": "string",
      "description": "Bank transaction ID. Either DEP-* (deposit) or TRF-* (transfer)."
    }
  },
  "required": ["transactionId"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "transactionId": { "type": "string" },
    "type": { "type": "string", "enum": ["DEPOSIT", "TRANSFER"] },
    "status": {
      "type": "string",
      "enum": ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REVERSED"],
      "description": "Terminal states: COMPLETED, FAILED, REVERSED. Non-terminal: PENDING, PROCESSING."
    },
    "amount": { "type": "number" },
    "currency": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "failureReason": { "type": "string", "description": "Only present when status=FAILED" }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `TRANSACTION_NOT_FOUND` | 404 | Transaction ID does not exist | Verify ID. May be a race condition — retry after 1 min. |

#### Example

**Request:**
```json
{
  "tool": "get_transaction_status",
  "arguments": {
    "transactionId": "TRF-2026-00042"
  }
}
```

**Response:**
```json
{
  "transactionId": "TRF-2026-00042",
  "type": "TRANSFER",
  "status": "COMPLETED",
  "amount": 500.00,
  "currency": "BOB",
  "createdAt": "2026-03-04T14:30:00Z",
  "updatedAt": "2026-03-04T16:45:00Z"
}
```

---

### 5.5. `verify_account_ownership`

Verifies that a bank account belongs to a specific user. This is a prerequisite before linking a wallet to a bank account.

**When to use:** During user onboarding, before calling `link_wallet_to_account` or `link_bank_account`. Must be called to prevent a user from linking someone else's bank account.

**Pre-validations:** Both `userId` and `bankAccountId` must not be empty.

**What to do if the bank API call fails:** Standard retry on 5xx.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "userId": {
      "type": "string",
      "description": "User ID in the bank system"
    },
    "bankAccountId": {
      "type": "string",
      "description": "Bank account ID to verify ownership of"
    }
  },
  "required": ["userId", "bankAccountId"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "verified": { "type": "boolean", "description": "true if the user owns this account" },
    "userId": { "type": "string" },
    "bankAccountId": { "type": "string" },
    "accountHolder": { "type": "string", "description": "Partially masked name of the account holder (e.g., 'Juan P****z')" },
    "accountStatus": { "type": "string", "enum": ["ACTIVE", "INACTIVE", "FROZEN"] }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `USER_NOT_FOUND` | 404 | User does not exist in bank system | Verify userId |
| `ACCOUNT_NOT_FOUND` | 404 | Bank account does not exist | Verify bankAccountId |

#### Example

**Request:**
```json
{
  "tool": "verify_account_ownership",
  "arguments": {
    "userId": "USR-BOL-12345",
    "bankAccountId": "ACCT-USR-789"
  }
}
```

**Response:**
```json
{
  "verified": true,
  "userId": "USR-BOL-12345",
  "bankAccountId": "ACCT-USR-789",
  "accountHolder": "Juan P****z",
  "accountStatus": "ACTIVE"
}
```

---

### 5.6. `link_wallet_to_account`

Creates an offchain record in the bank's system linking a blockchain wallet address to a bank account. This tells the bank where to send funds when processing redemptions.

**When to use:** During user onboarding, AFTER `verify_account_ownership` returns `verified: true`. This is the offchain counterpart to `link_bank_account` (which writes onchain).

**Pre-validations:**
1. `walletAddress` matches pattern `^0x[a-fA-F0-9]{40}$`
2. `verify_account_ownership` was called and returned `verified: true` for this userId + bankAccountId pair
3. The MCP should track this verification state internally (e.g., in a session or cache)

**What to do if the bank API call fails:** Standard retry on 5xx.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "userId": {
      "type": "string",
      "description": "User ID in the bank system"
    },
    "bankAccountId": {
      "type": "string",
      "description": "Bank account ID (must be verified with verify_account_ownership first)"
    },
    "walletAddress": {
      "type": "string",
      "description": "Base blockchain wallet address (0x...)",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    }
  },
  "required": ["userId", "bankAccountId", "walletAddress"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "linkId": { "type": "string", "description": "Bank's internal link record ID" },
    "userId": { "type": "string" },
    "bankAccountId": { "type": "string" },
    "walletAddress": { "type": "string" },
    "linkedAt": { "type": "string", "format": "date-time" }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `OWNERSHIP_NOT_VERIFIED` | 403 | verify_account_ownership was not called first | Call verify_account_ownership first |
| `WALLET_ALREADY_LINKED` | 409 | Wallet already linked to another account | Check existing link |
| `ACCOUNT_ALREADY_LINKED` | 409 | Account already has a wallet linked | Check existing link |
| `INVALID_WALLET` | 400 | Wallet address format invalid | Fix wallet address |

#### Example

**Request:**
```json
{
  "tool": "link_wallet_to_account",
  "arguments": {
    "userId": "USR-BOL-12345",
    "bankAccountId": "ACCT-USR-789",
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
  }
}
```

**Response:**
```json
{
  "success": true,
  "linkId": "LNK-2026-00015",
  "userId": "USR-BOL-12345",
  "bankAccountId": "ACCT-USR-789",
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "linkedAt": "2026-03-04T10:00:00Z"
}
```

---

### 5.7. `generate_uif_report`

Files a Suspicious Activity Report (SAR) with the UIF (Unidad de Investigaciones Financieras), Bolivia's financial intelligence unit. Required by AML regulations.

**When to use:** When the PolicyManager smart contract emits a `UIFReport` event indicating suspicious activity detected by AML rules, or when the agent detects suspicious patterns.

**Pre-validations:**
1. `walletAddress` matches pattern `^0x[a-fA-F0-9]{40}$`
2. `transactionIds` array is not empty
3. `reason` is one of the allowed enum values

**What to do if the bank API call fails:** Retry on 5xx. This is a compliance-critical operation — if it fails persistently, create an internal alert. The report MUST eventually be filed.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "userId": {
      "type": "string",
      "description": "User ID of the reported individual"
    },
    "walletAddress": {
      "type": "string",
      "description": "Wallet address involved in suspicious activity",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "reason": {
      "type": "string",
      "description": "Category of suspicious activity",
      "enum": [
        "HIGH_FREQUENCY_TRANSACTIONS",
        "AMOUNT_EXCEEDS_THRESHOLD",
        "STRUCTURING_DETECTED",
        "SANCTIONED_INTERACTION",
        "MANUAL_FLAG"
      ]
    },
    "transactionIds": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of related transaction IDs (DEP-* or TRF-*)",
      "minItems": 1
    },
    "additionalNotes": {
      "type": "string",
      "description": "Free-text notes from the agent explaining the suspicion"
    }
  },
  "required": ["userId", "walletAddress", "reason", "transactionIds"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "reportId": { "type": "string", "description": "Internal report ID" },
    "status": { "type": "string", "enum": ["FILED", "PENDING_REVIEW"] },
    "filedAt": { "type": "string", "format": "date-time" },
    "referenceNumber": { "type": "string", "description": "UIF reference number for tracking" }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `USER_NOT_FOUND` | 404 | User does not exist | Verify userId |
| `DUPLICATE_REPORT` | 409 | Active report already exists for these transactions | No action (idempotent) |
| `INVALID_REASON` | 400 | Reason not in allowed enum | Fix reason field |

#### Example

**Request:**
```json
{
  "tool": "generate_uif_report",
  "arguments": {
    "userId": "USR-BOL-12345",
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
    "reason": "AMOUNT_EXCEEDS_THRESHOLD",
    "transactionIds": ["DEP-2026-00050", "DEP-2026-00051"],
    "additionalNotes": "Two deposits of 99,000 BOB within 10 minutes"
  }
}
```

**Response:**
```json
{
  "success": true,
  "reportId": "UIF-2026-00003",
  "status": "FILED",
  "filedAt": "2026-03-04T15:00:00Z",
  "referenceNumber": "UIF-REF-2026-0042"
}
```

---

### 5.8. `get_account_history`

Retrieves the transaction history for a bank account. Used for auditing, reconciliation, and investigating suspicious activity.

**When to use:** When investigating a suspicious activity report, reconciling bank transactions with onchain activity, or providing account context for compliance decisions.

**Pre-validations:**
1. `bankAccountId` is not empty
2. If `fromDate` and `toDate` are both provided, the range must be <= 90 days
3. `limit` must be between 1 and 200

**What to do if the bank API call fails:** Standard retry on 5xx.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "bankAccountId": {
      "type": "string",
      "description": "Bank account ID to query"
    },
    "fromDate": {
      "type": "string",
      "format": "date",
      "description": "Start date (YYYY-MM-DD). Defaults to 30 days ago."
    },
    "toDate": {
      "type": "string",
      "format": "date",
      "description": "End date (YYYY-MM-DD). Defaults to today."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum number of results to return",
      "default": 50,
      "minimum": 1,
      "maximum": 200
    },
    "offset": {
      "type": "integer",
      "description": "Offset for pagination",
      "default": 0,
      "minimum": 0
    }
  },
  "required": ["bankAccountId"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "bankAccountId": { "type": "string" },
    "transactions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "transactionId": { "type": "string" },
          "type": { "type": "string", "enum": ["DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"] },
          "amount": { "type": "number" },
          "currency": { "type": "string" },
          "status": { "type": "string" },
          "reference": { "type": "string" },
          "timestamp": { "type": "string", "format": "date-time" }
        }
      }
    },
    "totalCount": { "type": "integer", "description": "Total matching transactions (for pagination)" },
    "hasMore": { "type": "boolean", "description": "true if there are more results beyond offset+limit" }
  }
}
```

#### Errors

| Code | HTTP | Description | Agent action |
|------|------|-------------|--------------|
| `ACCOUNT_NOT_FOUND` | 404 | Account does not exist | Verify bankAccountId |
| `DATE_RANGE_TOO_WIDE` | 400 | Date range exceeds 90 days | Narrow the date range |
| `UNAUTHORIZED` | 403 | No permission to view this account | Check OAuth scopes |

#### Example

**Request:**
```json
{
  "tool": "get_account_history",
  "arguments": {
    "bankAccountId": "ACCT-USR-789",
    "fromDate": "2026-03-01",
    "toDate": "2026-03-04",
    "limit": 10
  }
}
```

**Response:**
```json
{
  "bankAccountId": "ACCT-USR-789",
  "transactions": [
    {
      "transactionId": "DEP-2026-00001",
      "type": "DEPOSIT",
      "amount": 1000.00,
      "currency": "BOB",
      "status": "COMPLETED",
      "reference": "Cash deposit",
      "timestamp": "2026-03-04T14:30:00Z"
    }
  ],
  "totalCount": 1,
  "hasMore": false
}
```

---

## 6. Contract Admin Tools (Onchain)

These tools send transactions to smart contracts on Base. They require:
- A funded wallet (ETH for gas on Base)
- The wallet must hold the appropriate role on each contract
- The MCP server must use ethers.js (or equivalent) to sign and send transactions
- All transactions must wait for at least 1 confirmation before returning success

### Common onchain error handling

For ALL onchain tools, apply this error handling:

| Scenario | Action |
|----------|--------|
| Transaction reverted | Parse the revert reason. Return `TX_REVERTED` with the reason string. Do NOT retry (revert reasons are deterministic). |
| Insufficient gas | Return `INSUFFICIENT_GAS`. Alert admin to fund the wallet. |
| Nonce too low | Re-fetch nonce and retry once. |
| Network timeout | Retry up to 2 times. If the transaction was sent but not confirmed, DO NOT re-send (risk of duplicate). Instead, wait for the pending transaction. |
| RPC error | Try fallback RPC endpoint. If all fail, return `RPC_UNAVAILABLE`. |

### 6.1. `register_identity`

Registers a KYC-verified identity on the CCIDRegistry smart contract. This is the onchain representation of a user's KYC status, enabling them to use the system (mint, transfer, redeem).

**When to use:** After the bank has completed KYC verification for a new user. This is part of the onboarding flow.

**Contract:** `CCIDRegistry.registerIdentity(address wallet, uint8 tier, bytes32 credentialHash)`
**Role required:** `REGISTRAR_ROLE`

**Pre-validations the MCP server MUST perform:**
1. `wallet` is a valid Ethereum address (checksum)
2. `tier` is one of KYC1, KYC2, KYC3
3. `credentialHash` is a valid bytes32 hex string
4. Query `CCIDRegistry.hasIdentity(wallet)` — if true, return `WALLET_ALREADY_REGISTERED` without sending a transaction
5. Verify with the bank that KYC is complete for this user (internal check)

**Tier mapping for the contract:**

| Tier string | uint8 value | Monthly limit |
|-------------|-------------|---------------|
| `KYC1` | 1 | 10,000 BOB |
| `KYC2` | 2 | 100,000 BOB |
| `KYC3` | 3 | Unlimited (monitored) |

**What to do if the transaction fails:**
- Revert with "already registered": Return `WALLET_ALREADY_REGISTERED`
- Revert with "access denied" or similar: The wallet does not have `REGISTRAR_ROLE`. Escalate to admin.
- Other revert: Return `TX_REVERTED` with the revert reason.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "description": "User's wallet address on Base",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "tier": {
      "type": "string",
      "description": "KYC level completed by the bank",
      "enum": ["KYC1", "KYC2", "KYC3"]
    },
    "credentialHash": {
      "type": "string",
      "description": "keccak256 hash of the identity document (CI number or NIT). Computed as keccak256(abi.encodePacked(documentType, documentNumber)).",
      "pattern": "^0x[a-fA-F0-9]{64}$"
    }
  },
  "required": ["wallet", "tier", "credentialHash"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "wallet": { "type": "string" },
    "tier": { "type": "string" },
    "txHash": { "type": "string", "description": "Onchain transaction hash. Can be verified on BaseScan." },
    "registeredAt": { "type": "string", "format": "date-time" }
  }
}
```

#### Errors

| Code | Source | Description | Agent action |
|------|--------|-------------|--------------|
| `WALLET_ALREADY_REGISTERED` | Pre-check / Contract | Wallet already has identity | No action needed |
| `INVALID_CREDENTIAL_HASH` | Validation | Not a valid bytes32 | Fix input |
| `KYC_NOT_COMPLETED` | Bank check | Bank has not completed KYC | Wait for bank KYC |
| `TX_REVERTED` | Contract | Transaction reverted | Check revert reason, escalate if role issue |
| `INSUFFICIENT_GAS` | Wallet | Not enough ETH for gas | Alert admin to fund wallet |

#### Example

**Request:**
```json
{
  "tool": "register_identity",
  "arguments": {
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
    "tier": "KYC2",
    "credentialHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }
}
```

**Response:**
```json
{
  "success": true,
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "tier": "KYC2",
  "txHash": "0x9876...fedc",
  "registeredAt": "2026-03-04T11:00:00Z"
}
```

---

### 6.2. `revoke_identity`

Revokes a user's identity from the CCIDRegistry. After revocation, the user cannot mint, transfer, or redeem tokens until re-registered.

**When to use:** When fraud is detected, the user requests account closure, their identity document expires, or a regulatory order requires it.

**Contract:** `CCIDRegistry.revokeIdentity(address wallet)`
**Role required:** `REGISTRAR_ROLE`

**Pre-validations the MCP server MUST perform:**
1. `wallet` is a valid Ethereum address
2. `internalConfirmation` is true (the agent must explicitly confirm)
3. Query `CCIDRegistry.hasIdentity(wallet)` — if false, return `WALLET_NOT_REGISTERED` without sending a transaction
4. Log the reason and wallet BEFORE sending the transaction (for audit trail even if tx fails)

**What to do if the transaction fails:**
- Revert with "not registered": Return `WALLET_NOT_REGISTERED`
- Other revert: Return `TX_REVERTED` with reason

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "description": "Wallet address to revoke identity for",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "reason": {
      "type": "string",
      "description": "Why the identity is being revoked",
      "enum": [
        "fraud_detected",
        "user_request",
        "document_expired",
        "regulatory_order",
        "deceased",
        "duplicate_identity"
      ]
    },
    "internalConfirmation": {
      "type": "boolean",
      "description": "Explicit confirmation that the reason has been verified internally. Must be true.",
      "const": true
    }
  },
  "required": ["wallet", "reason", "internalConfirmation"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "wallet": { "type": "string" },
    "reason": { "type": "string" },
    "txHash": { "type": "string" },
    "revokedAt": { "type": "string", "format": "date-time" },
    "previousTier": { "type": "string", "description": "KYC tier the user had before revocation" }
  }
}
```

#### Errors

| Code | Source | Description | Agent action |
|------|--------|-------------|--------------|
| `WALLET_NOT_REGISTERED` | Pre-check / Contract | No identity to revoke | No action |
| `CONFIRMATION_REQUIRED` | Validation | internalConfirmation is not true | Agent must confirm |
| `TX_REVERTED` | Contract | Transaction reverted | Check revert reason |

#### Example

**Request:**
```json
{
  "tool": "revoke_identity",
  "arguments": {
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
    "reason": "document_expired",
    "internalConfirmation": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "reason": "document_expired",
  "txHash": "0xaaaa...bbbb",
  "revokedAt": "2026-03-04T12:00:00Z",
  "previousTier": "KYC2"
}
```

---

### 6.3. `link_bank_account`

Records the wallet-to-bank-account link on the RedeemContract smart contract. This onchain record is required for the contract to allow redemption requests from this wallet.

**When to use:** During onboarding, AFTER `verify_account_ownership` returns true. This is the onchain counterpart to `link_wallet_to_account` (which writes offchain to the bank).

**Contract:** `RedeemContract.linkBankAccount(address wallet, string bankAccountId)`
**Role required:** `OPERATOR_ROLE`

**Pre-validations the MCP server MUST perform:**
1. `wallet` is a valid Ethereum address
2. `bankAccountId` is not empty
3. Verify that `verify_account_ownership` was called for this pair (track internally)
4. Query `CCIDRegistry.hasIdentity(wallet)` — wallet must have a registered identity

**What to do if the transaction fails:**
- Revert with "no identity": Wallet not registered in CCIDRegistry. Call `register_identity` first.
- Revert with "already linked": Return `ACCOUNT_ALREADY_LINKED`

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "description": "User's wallet address on Base",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "bankAccountId": {
      "type": "string",
      "description": "Bank account ID (must have been verified with verify_account_ownership)"
    }
  },
  "required": ["wallet", "bankAccountId"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "wallet": { "type": "string" },
    "bankAccountId": { "type": "string" },
    "txHash": { "type": "string" },
    "linkedAt": { "type": "string", "format": "date-time" }
  }
}
```

#### Errors

| Code | Source | Description | Agent action |
|------|--------|-------------|--------------|
| `OWNERSHIP_NOT_VERIFIED` | Validation | verify_account_ownership not called | Call verify_account_ownership first |
| `WALLET_NOT_REGISTERED` | Pre-check | No identity in CCIDRegistry | Call register_identity first |
| `ACCOUNT_ALREADY_LINKED` | Contract | This account is linked to another wallet | Check existing link |
| `TX_REVERTED` | Contract | Transaction reverted | Check revert reason |

#### Example

**Request:**
```json
{
  "tool": "link_bank_account",
  "arguments": {
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
    "bankAccountId": "ACCT-USR-789"
  }
}
```

**Response:**
```json
{
  "success": true,
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "bankAccountId": "ACCT-USR-789",
  "txHash": "0xcccc...dddd",
  "linkedAt": "2026-03-04T10:30:00Z"
}
```

---

### 6.4. `freeze_wallet`

Freezes a wallet on the PolicyManager contract. A frozen wallet is blocked from ALL token operations: transfer, mint, and burn. Every freeze generates an audit log entry automatically.

**When to use:** When fraud is detected, a regulatory order is received, an AML alert fires, or a court order requires it. This is a compliance-critical operation.

**Contract:** `PolicyManager.freezeWallet(address wallet)`
**Role required:** `OPERATOR_ROLE`

**Pre-validations the MCP server MUST perform:**
1. `wallet` is a valid Ethereum address
2. `reason` is one of the allowed enum values
3. Query `PolicyManager.isFrozen(wallet)` — if already frozen, return `WALLET_ALREADY_FROZEN` without sending a transaction
4. Log the freeze request with reason and evidence BEFORE sending the transaction

**What to do if the transaction fails:**
- Revert with "already frozen": Return `WALLET_ALREADY_FROZEN`
- Other revert: Return `TX_REVERTED` with reason

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "description": "Wallet address to freeze",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "reason": {
      "type": "string",
      "description": "Reason for freezing the wallet",
      "enum": [
        "fraud_detected",
        "regulatory_order",
        "aml_flag",
        "court_order"
      ]
    },
    "evidence": {
      "type": "string",
      "description": "Reference to supporting evidence (UIF report ID, court order number, internal investigation ID)"
    }
  },
  "required": ["wallet", "reason"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "wallet": { "type": "string" },
    "reason": { "type": "string" },
    "txHash": { "type": "string" },
    "frozenAt": { "type": "string", "format": "date-time" },
    "auditLogId": { "type": "string", "description": "Internal audit log entry ID" }
  }
}
```

#### Errors

| Code | Source | Description | Agent action |
|------|--------|-------------|--------------|
| `WALLET_ALREADY_FROZEN` | Pre-check / Contract | Wallet is already frozen | No action needed |
| `WALLET_NOT_REGISTERED` | Contract | No identity in CCIDRegistry | Cannot freeze unregistered wallet |
| `TX_REVERTED` | Contract | Transaction reverted | Check revert reason |

#### Example

**Request:**
```json
{
  "tool": "freeze_wallet",
  "arguments": {
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
    "reason": "aml_flag",
    "evidence": "UIF-2026-00003"
  }
}
```

**Response:**
```json
{
  "success": true,
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "reason": "aml_flag",
  "txHash": "0xeeee...ffff",
  "frozenAt": "2026-03-04T15:30:00Z",
  "auditLogId": "AUDIT-2026-00789"
}
```

---

### 6.5. `unfreeze_wallet`

Unfreezes a wallet on the PolicyManager, restoring its ability to transfer, mint, and burn tokens.

**When to use:** Only when the original freeze cause has been resolved: investigation completed, court order lifted, or false positive confirmed. Every unfreeze requires a justification.

**Contract:** `PolicyManager.unfreezeWallet(address wallet)`
**Role required:** `OPERATOR_ROLE`

**Pre-validations the MCP server MUST perform:**
1. `wallet` is a valid Ethereum address
2. `reason` (justification) is not empty
3. Query `PolicyManager.isFrozen(wallet)` — if not frozen, return `WALLET_NOT_FROZEN`
4. Query `PolicyManager.isSanctioned(wallet)` — if sanctioned, return `SANCTIONS_BLOCK`. Sanctioned wallets can ONLY be unfrozen by the ADMIN_ROLE multisig, not by the agent.

**What to do if the transaction fails:**
- Revert with "not frozen": Return `WALLET_NOT_FROZEN`
- Revert with "sanctioned": Return `SANCTIONS_BLOCK`
- Other revert: Return `TX_REVERTED`

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "description": "Wallet address to unfreeze",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "reason": {
      "type": "string",
      "description": "Justification for unfreezing. Must explain why the original freeze cause is resolved."
    },
    "resolutionReference": {
      "type": "string",
      "description": "Reference to the resolution document (closed investigation ID, court order reference, etc.)"
    }
  },
  "required": ["wallet", "reason"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "wallet": { "type": "string" },
    "reason": { "type": "string" },
    "txHash": { "type": "string" },
    "unfrozenAt": { "type": "string", "format": "date-time" },
    "auditLogId": { "type": "string" },
    "previousFreezeReason": { "type": "string", "description": "Original reason the wallet was frozen" }
  }
}
```

#### Errors

| Code | Source | Description | Agent action |
|------|--------|-------------|--------------|
| `WALLET_NOT_FROZEN` | Pre-check | Wallet is not frozen | No action needed |
| `SANCTIONS_BLOCK` | Pre-check | Wallet is on sanctions list | Cannot unfreeze — only multisig (ADMIN_ROLE) can remove sanctions |
| `TX_REVERTED` | Contract | Transaction reverted | Check revert reason |

#### Example

**Request:**
```json
{
  "tool": "unfreeze_wallet",
  "arguments": {
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
    "reason": "Investigation completed, confirmed false positive",
    "resolutionReference": "CASE-2026-00042-CLOSED"
  }
}
```

**Response:**
```json
{
  "success": true,
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "reason": "Investigation completed, confirmed false positive",
  "txHash": "0x1111...2222",
  "unfrozenAt": "2026-03-05T09:00:00Z",
  "auditLogId": "AUDIT-2026-00801",
  "previousFreezeReason": "aml_flag"
}
```

---

### 6.6. `add_to_sanctions`

Adds a wallet to the sanctions list on the PolicyManager. This is a **high-impact, effectively irreversible** action: once sanctioned, a wallet can ONLY be removed from the sanctions list by the ADMIN_ROLE (human multisig, 3/5 signatures). The agent cannot undo this.

**When to use:** When a sanctions order is received from OFAC, the UIF (Bolivia), or an internal investigation confirms illicit activity. Use with extreme care.

**Contract:** `PolicyManager.addToSanctions(address wallet)`
**Role required:** `OPERATOR_ROLE` (to add). `ADMIN_ROLE` required to remove (NOT available to MCP).

**Pre-validations the MCP server MUST perform:**
1. `wallet` is a valid Ethereum address
2. `authority` is one of the allowed enum values
3. `reason` is not empty
4. Query `PolicyManager.isSanctioned(wallet)` — if already sanctioned, return `WALLET_ALREADY_SANCTIONED`
5. Log the sanction request with ALL fields BEFORE sending the transaction (this is an irreversible action — the audit trail must exist even if the tx fails)

**What to do if the transaction fails:**
- Revert with "already sanctioned": Return `WALLET_ALREADY_SANCTIONED`
- Other revert: Return `TX_REVERTED`

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "description": "Wallet address to sanction",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "reason": {
      "type": "string",
      "description": "Reason for the sanction"
    },
    "authority": {
      "type": "string",
      "description": "Authority ordering the sanction",
      "enum": ["OFAC", "UIF_BOLIVIA", "INTERNAL"]
    },
    "referenceDocument": {
      "type": "string",
      "description": "Reference number of the sanctions order or investigation report"
    }
  },
  "required": ["wallet", "reason", "authority"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "wallet": { "type": "string" },
    "authority": { "type": "string" },
    "txHash": { "type": "string" },
    "sanctionedAt": { "type": "string", "format": "date-time" },
    "auditLogId": { "type": "string" },
    "removalRequires": {
      "type": "string",
      "const": "ADMIN_ROLE (multisig 3/5)",
      "description": "Only the human multisig can remove sanctions"
    }
  }
}
```

#### Errors

| Code | Source | Description | Agent action |
|------|--------|-------------|--------------|
| `WALLET_ALREADY_SANCTIONED` | Pre-check | Already on sanctions list | No action needed |
| `WALLET_NOT_REGISTERED` | Contract | No identity in CCIDRegistry | Register identity first if needed, or sanction anyway depending on policy |
| `TX_REVERTED` | Contract | Transaction reverted | Check revert reason |

#### Example

**Request:**
```json
{
  "tool": "add_to_sanctions",
  "arguments": {
    "wallet": "0xDEAD00000000000000000000000000000000BEEF",
    "reason": "Listed on OFAC SDN update 2026-03",
    "authority": "OFAC",
    "referenceDocument": "OFAC-SDN-2026-03-UPDATE-42"
  }
}
```

**Response:**
```json
{
  "success": true,
  "wallet": "0xDEAD00000000000000000000000000000000BEEF",
  "authority": "OFAC",
  "txHash": "0x3333...4444",
  "sanctionedAt": "2026-03-04T16:00:00Z",
  "auditLogId": "AUDIT-2026-00810",
  "removalRequires": "ADMIN_ROLE (multisig 3/5)"
}
```

---

## 7. Roles and Governance

### Role hierarchy

```
┌────────────────────────────────────────────────────────────┐
│                      ADMIN_ROLE                            │
│                (Gnosis Safe Multisig)                       │
│                                                            │
│  Can: change limits, parameters, upgrades,                 │
│       remove sanctions, change roles,                      │
│       pause/unpause entire system                          │
│                                                            │
│  Requires: 3 of 5 human signatures                         │
├────────────────────────────────────────────────────────────┤
│       REGISTRAR_ROLE        │       OPERATOR_ROLE          │
│      (MCP Server Wallet)    │     (MCP Server Wallet)      │
│                             │                              │
│  CCIDRegistry:              │  PolicyManager:              │
│  - registerIdentity()       │  - freezeWallet()            │
│  - revokeIdentity()         │  - unfreezeWallet()          │
│                             │  - addToSanctions()          │
│                             │                              │
│                             │  RedeemContract:             │
│                             │  - linkBankAccount()         │
├─────────────────────────────┴──────────────────────────────┤
│                      ORACLE_ROLE                           │
│                   (Chainlink CRE Wallet)                   │
│                                                            │
│  FiatDepositOracle: confirmDeposit(), updateReserves()     │
│  MinterContract: mint()                                    │
│  RedeemContract: confirmRedeemExecuted()                   │
└────────────────────────────────────────────────────────────┘
```

### What the agent CAN do (REGISTRAR_ROLE + OPERATOR_ROLE)

| Role | Contract | Functions | Purpose |
|------|----------|-----------|---------|
| `REGISTRAR_ROLE` | CCIDRegistry | `registerIdentity()`, `revokeIdentity()` | Onboarding/offboarding users after bank KYC |
| `OPERATOR_ROLE` | PolicyManager | `freezeWallet()`, `unfreezeWallet()`, `addToSanctions()` | Reactive compliance enforcement |
| `OPERATOR_ROLE` | RedeemContract | `linkBankAccount()` | Link wallets to bank accounts for redemption |

### What the agent CANNOT do (requires ADMIN_ROLE multisig)

| Action | Contract | Function | Why restricted |
|--------|----------|----------|---------------|
| Change KYC tier limits | CCIDRegistry | `updateTierLimits()` | Affects all users |
| Remove from sanctions | PolicyManager | `removeFromSanctions()` | Irreversible by agent — human verification required |
| Change AML thresholds | PolicyManager | `updateAMLThresholds()` | Regulatory impact |
| Change fees | StablecoinBOB | `updateFees()` | Economic impact |
| Pause system | All | `pause()` | Emergency only |
| Upgrade contracts | Proxy | `upgradeTo()` | Logic change |
| Change oracle address | FiatDepositOracle | `updateOracleRole()` | Critical security |
| Grant/revoke roles | All | `grantRole()`, `revokeRole()` | Root access control |

### Why this separation matters for Bolivia

Bolivia is on the **FATF/GAFI enhanced monitoring list** (grey list) since 2020. This imposes strict compliance requirements:

1. **Separation of operational and administrative functions (FATF Recommendation 16):** Day-to-day operations (agent) must be separated from policy decisions (human multisig). An AI agent cannot have unilateral power over system parameters.

2. **Complete audit trail:** Every agent action generates an audit log with timestamp, reason, and reference. Multisig actions are recorded onchain with signer addresses. The UIF can audit both levels.

3. **Controlled irreversibility:** Sanctions can only be removed by humans (multisig) to prevent a compromised agent from unblocking sanctioned wallets.

4. **Principle of least privilege:** If the agent is compromised, the attacker can freeze wallets (limited, reversible damage) but cannot unfreeze sanctioned wallets, change parameters, or extract funds.

5. **Compliance with Bolivia's Ley 393 de Servicios Financieros:** Requires human oversight for decisions affecting financial parameters. The multisig satisfies this by requiring designated compliance officers' signatures.

---

## 8. End-to-End Flows

### 8.1. Onboarding Flow (New User)

A new user registers, completes bank KYC, and is set up to use the BOB Stablecoin system.

```
  Bank                MCP Server            CCIDRegistry       RedeemContract        Bank DB
   │                      │                      │                  │                   │
   │  KYC completed       │                      │                  │                   │
   │─────────────────────►│                      │                  │                   │
   │                      │                      │                  │                   │
   │                      │ verify_account_       │                  │                   │
   │◄─────────────────────│ ownership             │                  │                   │
   │  verified: true      │                      │                  │                   │
   │─────────────────────►│                      │                  │                   │
   │                      │                      │                  │                   │
   │                      │ register_identity()  │                  │                   │
   │                      │─────────────────────►│                  │                   │
   │                      │  txHash              │                  │                   │
   │                      │◄─────────────────────│                  │                   │
   │                      │                      │                  │                   │
   │                      │ link_bank_account()  │                  │                   │
   │                      │──────────────────────┼─────────────────►│                   │
   │                      │  txHash              │                  │                   │
   │                      │◄─────────────────────┼──────────────────│                   │
   │                      │                      │                  │                   │
   │                      │ link_wallet_to_       │                  │                   │
   │◄─────────────────────│ account              │                  │                   │
   │  linkId              │──────────────────────┼──────────────────┼──────────────────►│
   │─────────────────────►│                      │                  │                   │
   │                      │                      │                  │                   │
   ▼                      ▼                      ▼                  ▼                   ▼
                    User can now mint, transfer, and redeem
```

**Sequence:**
1. Bank completes KYC → notifies MCP
2. MCP calls `verify_account_ownership(userId, bankAccountId)` → bank confirms ownership
3. MCP calls `register_identity(wallet, tier, credentialHash)` → writes to CCIDRegistry onchain
4. MCP calls `link_bank_account(wallet, bankAccountId)` → writes to RedeemContract onchain
5. MCP calls `link_wallet_to_account(userId, bankAccountId, walletAddress)` → writes to bank DB offchain
6. User is fully onboarded and can operate

### 8.2. Mint Flow (Deposit Fiat, Receive Tokens)

```
  User        Bank           MCP Server          CRE            FiatDepositOracle   MinterContract   StablecoinBOB
   │            │                │                 │                   │                  │                │
   │ deposit    │                │                 │                   │                  │                │
   │ BOB fiat   │                │                 │                   │                  │                │
   │───────────►│                │                 │                   │                  │                │
   │            │  webhook       │                 │                   │                  │                │
   │            │───────────────►│                 │                   │                  │                │
   │            │                │                 │                   │                  │                │
   │            │  confirm_      │                 │                   │                  │                │
   │            │◄───────────────│                 │                   │                  │                │
   │            │  deposit       │                 │                   │                  │                │
   │            │───────────────►│                 │                   │                  │                │
   │            │                │  confirmed data │                   │                  │                │
   │            │                │────────────────►│                   │                  │                │
   │            │                │                 │ confirmDeposit()  │                  │                │
   │            │                │                 │──────────────────►│                  │                │
   │            │                │                 │                   │                  │                │
   │            │                │                 │ mint()            │                  │                │
   │            │                │                 │──────────────────────────────────────►│                │
   │            │                │                 │                   │                  │ mint to user   │
   │            │                │                 │                   │                  │───────────────►│
   │◄───────────┼────────────────┼─────────────────┼───────────────────┼──────────────────┼────────────────│
   │  tokens    │                │                 │                   │                  │                │
   │  received  │                │                 │                   │                  │                │
```

**Key point:** The MCP confirms the deposit with the bank. The CRE handles everything onchain (confirmDeposit + mint). The MCP does NOT mint tokens.

### 8.3. Redeem Flow (Burn Tokens, Receive Fiat)

```
  User        RedeemContract      CRE           MCP Server         Bank
   │               │                │               │                │
   │ requestRedeem │                │               │                │
   │ (burns tokens)│                │               │                │
   │──────────────►│                │               │                │
   │               │                │               │                │
   │               │ event:         │               │                │
   │               │ RedeemRequested│               │                │
   │               │───────────────►│               │                │
   │               │                │               │                │
   │               │                │ execute_bank_ │                │
   │               │                │ transfer      │                │
   │               │                │──────────────►│                │
   │               │                │               │  POST /transfer│
   │               │                │               │───────────────►│
   │               │                │               │  INITIATED     │
   │               │                │               │◄───────────────│
   │               │                │  transferId   │                │
   │               │                │◄──────────────│                │
   │               │                │               │                │
   │               │                │  (polls)      │                │
   │               │                │ get_transaction│                │
   │               │                │ _status       │                │
   │               │                │──────────────►│                │
   │               │                │               │───────────────►│
   │               │                │               │  COMPLETED     │
   │               │                │               │◄───────────────│
   │               │                │◄──────────────│                │
   │               │                │               │                │
   │               │ confirmRedeem  │               │                │
   │               │ Executed()     │               │                │
   │               │◄───────────────│               │                │
   │               │                │               │                │
   │◄──────────────│ fiat received  │               │                │
```

### 8.4. Proof of Reserves Flow

```
  Chainlink Automation     CRE           MCP Server         Bank
         │                  │               │                │
         │ trigger (24h)    │               │                │
         │─────────────────►│               │                │
         │                  │               │                │
         │                  │ get_reserves_ │                │
         │                  │ balance       │                │
         │                  │──────────────►│                │
         │                  │               │ GET /reserves  │
         │                  │               │───────────────►│
         │                  │               │  balance       │
         │                  │               │◄───────────────│
         │                  │  balance      │                │
         │                  │◄──────────────│                │
         │                  │               │                │
         │                  │ updateReserves() onchain       │
         │                  │──────────────►│                │
         │                  │               │                │
         │                  │ if balance < totalSupply:      │
         │                  │   emit ReservesDeficit         │
         │                  │   pause minting                │
```

### 8.5. Freeze/Unfreeze Flow (Compliance)

```
Freeze:
1. AML alert fires OR regulatory order received
2. Agent calls freeze_wallet(wallet, reason, evidence) → PolicyManager onchain
3. Wallet is blocked from all operations immediately
4. If applicable: agent calls generate_uif_report() → files SAR with UIF

Unfreeze:
1. Investigation completed OR false positive confirmed
2. Agent calls unfreeze_wallet(wallet, reason, resolutionReference) → PolicyManager onchain
3. Wallet restored (UNLESS it is on the sanctions list — then only multisig can unblock)

Sanctions (irreversible by agent):
1. OFAC/UIF/internal order confirmed
2. Agent calls add_to_sanctions(wallet, reason, authority) → PolicyManager onchain
3. Wallet permanently blocked
4. Only ADMIN_ROLE (3/5 multisig) can remove the sanction
```

### 8.6. UIF Report Flow (Suspicious Activity)

```
  PolicyManager        MCP Server          Bank API
       │                   │                  │
       │ event: UIFReport  │                  │
       │ (userId, wallet,  │                  │
       │  reason)          │                  │
       │──────────────────►│                  │
       │                   │                  │
       │                   │ get_account_     │
       │                   │ history          │
       │                   │─────────────────►│
       │                   │ transactions     │
       │                   │◄─────────────────│
       │                   │                  │
       │                   │ generate_uif_    │
       │                   │ report           │
       │                   │─────────────────►│
       │                   │ reportId, ref#   │
       │                   │◄─────────────────│
       │                   │                  │
       │                   │ (optionally)     │
       │                   │ freeze_wallet()  │
       │                   │──► PolicyManager │
```

---

## 9. Setup and Configuration

### Environment Variables

The MCP server requires the following configuration:

```bash
# ============================================================
# Bank API Configuration
# ============================================================

# Bank API base URL
BANK_API_URL=https://sandbox.banco-bol.example/api/v1      # testnet
# BANK_API_URL=https://api.banco-bol.example/api/v1         # production

# OAuth2 credentials for bank API
BANK_OAUTH_TOKEN_URL=https://sandbox.banco-bol.example/oauth/token
BANK_OAUTH_CLIENT_ID=mcp-server-client-id
BANK_OAUTH_CLIENT_SECRET=<secret>

# HMAC shared secret for verifying bank response signatures
BANK_HMAC_SECRET=<shared-secret>

# Bank API timeout (milliseconds)
BANK_API_TIMEOUT=30000

# ============================================================
# Blockchain Configuration
# ============================================================

# Base RPC endpoint
BASE_RPC_URL=https://sepolia.base.org                       # testnet
# BASE_RPC_URL=https://mainnet.base.org                     # production

# Fallback RPC endpoint (used when primary fails)
BASE_RPC_URL_FALLBACK=https://base-sepolia.g.alchemy.com/v2/<key>

# MCP server wallet private key (holds REGISTRAR_ROLE + OPERATOR_ROLE)
# NEVER log or expose this value
MCP_WALLET_PRIVATE_KEY=<private-key>

# Chain ID
BASE_CHAIN_ID=84532                                          # Base Sepolia
# BASE_CHAIN_ID=8453                                         # Base Mainnet

# ============================================================
# Contract Addresses (provided after deployment)
# ============================================================

CONTRACT_CCID_REGISTRY=0x...
CONTRACT_POLICY_MANAGER=0x...
CONTRACT_REDEEM_CONTRACT=0x...
CONTRACT_STABLECOIN_BOB=0x...       # Read-only (for totalSupply checks)
CONTRACT_FIAT_DEPOSIT_ORACLE=0x...  # Read-only (for deposit status checks)

# ============================================================
# Operational Configuration
# ============================================================

# Audit log storage
AUDIT_LOG_PATH=/var/log/mcp-server/audit.jsonl

# Maximum retry attempts for bank API calls
BANK_MAX_RETRIES=3

# Maximum retry attempts for blockchain transactions
CHAIN_MAX_RETRIES=2

# Log level
LOG_LEVEL=info                                                # debug in development
```

### Contract ABIs

The MCP server needs ABIs for the 3 contracts it interacts with:

```
contracts/abi/CCIDRegistry.json
contracts/abi/PolicyManager.json
contracts/abi/RedeemContract.json
```

These will be provided after contract deployment. Place them in the MCP server's configuration directory.

### Wallet Setup

1. Generate a dedicated wallet for the MCP server (NOT a shared wallet)
2. Fund it with ETH on Base for gas (recommended: 0.1 ETH initial, monitor balance)
3. The admin multisig will grant `REGISTRAR_ROLE` on CCIDRegistry and `OPERATOR_ROLE` on PolicyManager and RedeemContract
4. Verify roles are active: call `hasRole(REGISTRAR_ROLE, walletAddress)` on each contract

### Health Check

The MCP server should expose a health check that verifies:
- Bank API is reachable (GET /health or similar)
- RPC endpoint is reachable (eth_blockNumber)
- Wallet has ETH for gas (> 0.01 ETH)
- Wallet holds expected roles on all 3 contracts
- OAuth token can be refreshed

---

## 10. Error Handling Reference

### Error response format

All tool errors must be returned in this format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description",
    "source": "bank_api | contract | validation | internal",
    "retryable": true,
    "details": {}
  }
}
```

### Complete error catalog

#### Bank API errors

| Code | HTTP | Source | Retryable | Description |
|------|------|--------|-----------|-------------|
| `BANK_SERVICE_UNAVAILABLE` | 503 | bank_api | Yes | Bank core system is down |
| `BANK_TIMEOUT` | - | bank_api | Yes | Request timed out after 30s |
| `BANK_AUTH_FAILED` | 401 | bank_api | Yes (refresh token) | OAuth token expired or invalid |
| `BANK_RATE_LIMITED` | 429 | bank_api | Yes (after Retry-After) | Too many requests |
| `INVALID_TX_ID` | 400 | bank_api | No | Transaction ID format invalid |
| `USER_NOT_FOUND` | 404 | bank_api | No | User ID not in bank system |
| `ACCOUNT_NOT_FOUND` | 404 | bank_api | No | Bank account not found |
| `ACCOUNT_FROZEN` | 403 | bank_api | No | Bank account is frozen |
| `DUPLICATE_DEPOSIT` | 409 | bank_api | No | Already processed (idempotent — treat as success) |
| `DUPLICATE_REDEEM` | 409 | bank_api | No | Already processed (idempotent — treat as success) |
| `INSUFFICIENT_FUNDS` | 400 | bank_api | No | Custodial account lacks funds (critical) |
| `TRANSFER_LIMIT_EXCEEDED` | 400 | bank_api | No | Daily transfer limit hit |
| `AMOUNT_EXCEEDS_LIMIT` | 400 | bank_api | No | Deposit exceeds allowed amount |
| `INVALID_ACCOUNT` | 400 | bank_api | No | Destination account invalid |
| `OWNERSHIP_NOT_VERIFIED` | 403 | bank_api | No | Must call verify_account_ownership first |
| `WALLET_ALREADY_LINKED` | 409 | bank_api | No | Wallet linked to another account |
| `ACCOUNT_ALREADY_LINKED` | 409 | bank_api | No | Account has a wallet already |
| `INVALID_WALLET` | 400 | bank_api | No | Wallet address format invalid |
| `DUPLICATE_REPORT` | 409 | bank_api | No | UIF report already filed |
| `INVALID_REASON` | 400 | bank_api | No | Reason not in allowed enum |
| `DATE_RANGE_TOO_WIDE` | 400 | bank_api | No | Range > 90 days |
| `UNAUTHORIZED` | 403 | bank_api | No | Missing required OAuth scope |
| `TRANSACTION_NOT_FOUND` | 404 | bank_api | Yes (race condition) | Transaction not yet visible |

#### Contract / blockchain errors

| Code | Source | Retryable | Description |
|------|--------|-----------|-------------|
| `TX_REVERTED` | contract | No | Transaction reverted (parse revert reason) |
| `INSUFFICIENT_GAS` | contract | No (need admin) | Wallet ETH balance too low for gas |
| `RPC_UNAVAILABLE` | contract | Yes | All RPC endpoints failed |
| `NONCE_TOO_LOW` | contract | Yes (auto-fix) | Nonce conflict, re-fetch and retry |
| `WALLET_ALREADY_REGISTERED` | contract | No | Identity already exists |
| `WALLET_NOT_REGISTERED` | contract | No | No identity to operate on |
| `WALLET_ALREADY_FROZEN` | contract | No | Already frozen (idempotent) |
| `WALLET_NOT_FROZEN` | contract | No | Not frozen, nothing to unfreeze |
| `WALLET_ALREADY_SANCTIONED` | contract | No | Already on sanctions list |
| `SANCTIONS_BLOCK` | contract | No | Cannot unfreeze sanctioned wallet |
| `ACCOUNT_ALREADY_LINKED` | contract | No | Onchain link already exists |

#### Validation errors

| Code | Source | Description |
|------|--------|-------------|
| `INVALID_INPUT` | validation | Input does not match JSON Schema |
| `CONFIRMATION_REQUIRED` | validation | internalConfirmation must be true |
| `KYC_NOT_COMPLETED` | validation | Bank KYC not done for this user |

### HMAC Signature Verification

Every bank API response includes a `signature` field. The MCP server MUST verify it:

```
Expected = HMAC-SHA256(response_body_bytes, BANK_HMAC_SECRET)
Actual   = response.signature

If Expected != Actual → reject response, log INVALID_SIGNATURE alert
```

### Nonce Verification (Anti-replay)

Every bank API response includes a `nonce` field (monotonically increasing integer). The MCP server MUST:

1. Track the last seen nonce per endpoint
2. Reject any response where `nonce <= lastSeenNonce`
3. Update `lastSeenNonce = nonce` after successful processing
4. Store `lastSeenNonce` in persistent storage (survives restarts)

---

## 11. Rate Limits

| Tool | Limit | Period | Notes |
|------|-------|--------|-------|
| `confirm_deposit` | 100 | per hour | |
| `get_reserves_balance` | 50 | per hour | |
| `execute_bank_transfer` | 50 | per hour | |
| `get_transaction_status` | 200 | per hour | Higher limit for polling |
| `verify_account_ownership` | 100 | per hour | |
| `link_wallet_to_account` | 20 | per hour | |
| `generate_uif_report` | 10 | per hour | |
| `get_account_history` | 100 | per hour | |
| `register_identity` | 50 | per hour | Onchain — also limited by gas |
| `revoke_identity` | 20 | per hour | |
| `link_bank_account` | 50 | per hour | Onchain |
| `freeze_wallet` | 30 | per hour | |
| `unfreeze_wallet` | 20 | per hour | |
| `add_to_sanctions` | 10 | per hour | High-impact action |

When the bank API returns HTTP 429, it includes a `Retry-After` header (seconds). The MCP server must respect this and not retry until after that period.

Onchain tools are additionally rate-limited by gas availability and block confirmation times.

---

## 12. Authentication

### Bank API Authentication (OAuth2)

| Field | Value |
|-------|-------|
| **Protocol** | OAuth2 Client Credentials |
| **Token endpoint** | `POST /oauth/token` (see env vars) |
| **Grant type** | `client_credentials` |
| **Token TTL** | 1 hour |
| **Token refresh** | Request new token when current one expires or returns 401 |

**OAuth scopes:**

| Scope | Tools |
|-------|-------|
| `deposits:read` | `confirm_deposit`, `get_transaction_status` |
| `deposits:write` | `confirm_deposit` |
| `reserves:read` | `get_reserves_balance` |
| `transfers:write` | `execute_bank_transfer` |
| `accounts:read` | `verify_account_ownership`, `get_account_history` |
| `accounts:write` | `link_wallet_to_account` |
| `compliance:write` | `generate_uif_report` |
| `identity:write` | `register_identity`, `revoke_identity` (bank-side validation) |
| `policy:write` | `freeze_wallet`, `unfreeze_wallet`, `add_to_sanctions` (bank-side audit logging) |
| `redeem:write` | `link_bank_account` (bank-side validation) |

### Blockchain Authentication

The MCP server wallet signs all transactions with its private key. No additional authentication is needed — role checks are enforced by the smart contracts themselves (`onlyRole(REGISTRAR_ROLE)` etc.).

---

## 13. Environments

### Testnet (Base Sepolia)

| Setting | Value |
|---------|-------|
| **Chain** | Base Sepolia (chain ID: 84532) |
| **Bank API** | Sandbox (`sandbox.banco-bol.example`) |
| **Behavior** | Deposits confirm instantly. Transfers complete in 30 seconds. |
| **Test accounts** | `USR-TEST-001` + `ACCT-TEST-001`, `USR-TEST-002` + `ACCT-TEST-002` |
| **HMAC secret** | Test secret (provided separately) |
| **Nonce validation** | Disabled (sandbox does not implement nonces) |
| **Gas** | Free from faucet |

### Production (Base Mainnet)

| Setting | Value |
|---------|-------|
| **Chain** | Base Mainnet (chain ID: 8453) |
| **Bank API** | Production (`api.banco-bol.example`) |
| **Behavior** | Deposits take minutes to hours. Transfers take hours to days. |
| **mTLS** | Required — the MCP server must present a client certificate |
| **IP whitelist** | MCP server IP must be whitelisted by the bank |
| **HMAC secret** | Production secret (rotated every 90 days) |
| **Nonce validation** | Enabled |
| **Gas** | Must fund wallet with real ETH on Base |

---

## 14. Audit Logging

Every tool call must generate an audit log entry. This is a **regulatory requirement** — Bolivia's financial regulations require 5-year retention of all transaction records.

### Log entry format

```json
{
  "timestamp": "2026-03-04T14:30:00.123Z",
  "tool": "confirm_deposit",
  "category": "bank_api",
  "inputHash": "sha256:abcdef...",
  "userId": "USR-BOL-12345",
  "walletAddress": "0x742d...",
  "result": "SUCCESS",
  "errorCode": null,
  "responseTimeMs": 234,
  "callerAgent": "claude-agent-001",
  "txHash": null,
  "bankTransactionId": "DEP-2026-00001",
  "metadata": {}
}
```

### Required fields per tool category

| Field | Bank API tools | Onchain tools |
|-------|---------------|---------------|
| `timestamp` | Required | Required |
| `tool` | Required | Required |
| `inputHash` | Required (SHA-256 of input, excluding secrets) | Required |
| `userId` | If applicable | N/A |
| `walletAddress` | If applicable | Required |
| `result` | Required (SUCCESS/ERROR) | Required |
| `errorCode` | If error | If error |
| `responseTimeMs` | Required | Required |
| `callerAgent` | Required | Required |
| `txHash` | N/A | Required on success |
| `bankTransactionId` | If applicable | N/A |

### Storage

- Format: JSONL (one JSON object per line)
- Location: Configurable via `AUDIT_LOG_PATH`
- Rotation: Daily, with gzip compression
- Retention: Minimum 5 years
- Sensitive data: NEVER log private keys, OAuth tokens, HMAC secrets, or full bank account numbers. Use hashes or masked values.

### What MUST be logged before execution (for irreversible actions)

For `revoke_identity`, `add_to_sanctions`, and `freeze_wallet`, write the audit log entry BEFORE sending the transaction. This ensures the audit trail exists even if the transaction fails or the server crashes mid-execution.
