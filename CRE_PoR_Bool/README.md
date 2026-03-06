# Batch Minting with Dual Controls (Approval List + Proof-of-Reserves) via Chainlink CRE

This document describes the **batch minting module** for a stablecoin issuance flow that combines:

1. **Off-chain approvals** (an allowlist of order IDs that are permitted to mint), and
2. **Proof-of-Reserves (PoR)** (a strict on-chain balance delta check to ensure reserves match issuance).

The goal is **double assurance**: tokens are minted **only** when (a) an order is approved and (b) the reported reserve/bank balance increase exactly matches the total amount to be issued.

---

## High-Level Overview

Users request tokens by paying fiat and submitting their wallet address + proof of payment. A back-office agent verifies those submissions off-chain. Once a set of orders is approved, a CRE workflow publishes a report on-chain containing:

* the **current bank/reserve balance**, and
* the **list of approved order IDs**.

A receiver contract validates that:

> **newBalance − lastProcessedBalance == Σ(amounts of approved orders)**

If the equality holds, the contract mints all approved orders (batch) in a single execution, updates the processed balance pointer, and marks orders as processed.

If it doesn’t hold, **nothing mints**.

---

## Components

### 1) Smart Contracts (2)

#### A) Mintable ERC-20 Token

A standard ERC-20 token with restricted minting:

* `mint(to, amount)` can only be called by a configured `minter`.
* `setMinter(minter)` updates the authorized minter.

**Role in the system:** token issuance only; does not contain business logic.

#### B) Batch Receiver / Minter: `BatchPoRApprovalMinter`

This is the **only contract** CRE writes to. It has three responsibilities:

1. **Order registry**

   * Stores orders created by your backend/operator:

     * `orderId → {recipient, amount, status}`
2. **PoR gating**

   * Stores a pointer `lastProcessedBankBalance` to “consume” balance deltas once.
3. **Batch mint execution**

   * Receives CRE reports containing `(bankBalanceScaled, approvedIds[])`
   * Validates `delta == sum`
   * Mints each order in a loop
   * Marks orders as minted and advances the pointer

**Important constraint:** batch minting is O(n) in the number of approved IDs (loop). A hard cap (`maxIdsPerReport`) is used to avoid out-of-gas failures.

---

### 2) Off-Chain Services (2)

#### A) Batch API (Bank Balance + Approved IDs)

A simple API endpoint that returns:

```json
{
  "bankBalance": 150,
  "approvedIds": [1, 2]
}
```

* `bankBalance` is an **integer** (no decimals).
* `approvedIds` is a list of **order IDs** approved by your back-office agent.

> The API is the bridge between off-chain verification and on-chain execution.

#### B) Chainlink CRE Workflow (TypeScript)

The workflow:

1. Fetches `GET /batch`
2. Validates types and format
3. Scales the bank balance to token precision:

   * `bankBalanceScaled = bankBalance * 10^18`
4. Encodes the on-chain report payload:

   * `abi.encode(uint256 bankBalanceScaled, uint256[] approvedIds)`
5. Broadcasts the report to the receiver contract using `EVMClient.writeReport`

---

## Data Model

### Order

Each order is stored on-chain as:

* `orderId` (uint256): unique identifier you assign
* `recipient` (address): destination wallet
* `amount` (uint256): token amount in **18 decimals**
* `status`: `None | Pending | Minted | Cancelled`
* `createdAt` (uint256): timestamp

### Reserve Pointer

* `lastProcessedBankBalance` (uint256): the last reserve/bank balance that has already been “accounted for” in minting.

This prevents double minting from the same reserve amount.

---

## Core Invariant (Dual Safety Check)

When the receiver gets a report:

* `newBalance = bankBalanceScaled`
* `oldBalance = lastProcessedBankBalance`
* `delta = newBalance - oldBalance`
* `sum = Σ(order.amount for orderId in approvedIds)`

The transaction must satisfy:

> **delta == sum**

If true, mint and advance.
If false, revert and mint nothing.

---

## End-to-End Flow

### Step 1 — Create Orders (Pre-Orders)

When a user pays fiat and submits their wallet address and proof:

* Your backend assigns `orderId`
* Your backend/operator submits the order on-chain:

`createOrder(orderId, recipient, amountScaled)`

**Result:** Order becomes `Pending`.

---

### Step 2 — Off-Chain Verification (Approval)

Your back-office agent verifies payment off-chain (bank dashboard, payment provider, receipts, internal rules, etc.). When verified:

* Your system includes the orderId into the approved set (API-side):

  * `approvedIds = [ ...orderIds that are approved... ]`

---

### Step 3 — Reserve Confirmation (PoR)

Your system updates `bankBalance` in the API to the latest reserve balance.

In this design, minting is only possible when the balance delta matches the sum of approved mints.

---

### Step 4 — CRE Executes On-Chain Report

The CRE workflow runs (cron/manual), publishes `(bankBalanceScaled, approvedIds[])` to the receiver.

---

### Step 5 — Receiver Validates and Mints in Batch

On-chain, `BatchPoRApprovalMinter.onReport(...)`:

1. Rejects if balance decreased:

   * `newBalance >= lastProcessedBankBalance`
2. Rejects if too many IDs:

   * `approvedIds.length <= maxIdsPerReport`
3. Computes `delta` and `sum`
4. Requires `delta == sum`
5. Mints each order:

   * `token.mint(order.recipient, order.amount)`
6. Marks orders as `Minted`
7. Updates `lastProcessedBankBalance = newBalance`

---

## Precision and Units

* API uses **integer fiat units** (e.g., `150` Bs).
* Workflow scales to token precision using `parseUnits(balance, 18)`.
* Order amounts are stored in **18 decimals**.

Examples:

* 100 Bs → `100000000000000000000`
* 50 Bs → `50000000000000000000`
* Sum = 150 Bs → `150000000000000000000`

---

## Operational Playbook

### Deployment Checklist

1. Deploy **Token**
2. Deploy **BatchPoRApprovalMinter** with:

   * correct forwarder (MockForwarder for simulate/broadcast; KeystoneForwarder for production)
   * initial `lastProcessedBankBalance` (typically `0`)
3. Set token minter:

   * `token.setMinter(batchMinterAddress)`
4. Configure CRE workflow:

   * `receiverAddress = batchMinterAddress`
   * `url = http://.../batch`

---

### Batch Execution Checklist (Day-to-Day)

Before running the workflow:

1. Ensure orders exist on-chain and are `Pending`
2. Ensure API returns:

   * `bankBalance` reflecting the actual bank balance
   * `approvedIds` exactly matching the batch you want to mint
3. Ensure this equation will hold:

   * `bankBalanceScaled - lastProcessedBankBalance == Σ(amounts of approvedIds)`

Run CRE with broadcast (testnet):

* `cre workflow simulate ... --broadcast`

---

## Events and Observability

Recommended events (typical set):

* `OrderCreated(orderId, recipient, amount)`
* `OrderCancelled(orderId, reason)`
* `Minted(orderId, recipient, amount)`
* `BatchProcessed(newBankBalance, delta, sum, count)`

These allow you to build:

* operator dashboards
* auditing tools
* auto-removal of processed IDs in your API

---

## Security Considerations

### 1) Forwarder-Only Execution

`onReport` is restricted to the CRE forwarder:

* prevents arbitrary users from triggering mint

### 2) Non-Partial Minting

If *any* order in the batch is invalid (not pending, wrong status, etc.) or if PoR does not match, the entire batch reverts.

This avoids partial state and accounting drift.

### 3) Replay Protection

Orders can only move `Pending → Minted` once.
Re-sending the same ID again reverts (`NotPending`).

### 4) Gas / Batch Limits

Batch minting loops over IDs. Use:

* `maxIdsPerReport` (e.g., 25)
* split large batches into multiple reports

### 5) Pause Switch

Admin can pause minting for incidents:

* bad API data
* suspicious balance changes
* operational errors

---

## Troubleshooting Guide

### A) `DeltaMismatch(delta, sum)`

* The reported bank balance delta does not match sum of approved amounts.
* Fix by:

  * ensuring API `bankBalance` is correct
  * ensuring approvedIds exactly correspond to the sum you expect
  * ensuring `lastProcessedBankBalance` is what you think it is

### B) `NotPending(id)`

* The order ID does not exist or is not in `Pending`.
* Fix by:

  * creating the order first
  * not reusing already minted/cancelled IDs

### C) No mint occurs, but workflow writes successfully

* Common cause: `approvedIds` empty, or delta mismatch.
* Verify contract state and events.