# Chainlink CRE in BOBC — What it’s used for, why, and the end-to-end data flow

This section explains **how and why BOBC uses Chainlink CRE (Chainlink Runtime Environment)** as part of the stablecoin issuance system. It’s written to help Chainlink reviewers quickly understand **what CRE is doing**, **what it reads**, **what it writes**, and **how the on-chain contract enforces correctness**.

---

## On-chain receiver contract (Sepolia)

BOBC uses a single receiver contract that is the **target of CRE reports**:

* **`CRE_BOBC` (Sepolia):** `0x87ba13aF77c9c37aBa42232B4C625C066a433eeE`

```text id="o7ov8p"
https://sepolia.etherscan.io/address/0x87ba13aF77c9c37aBa42232B4C625C066a433eeE
```

This contract implements `IReceiver.onReport(...)` and is designed to accept **CRE-delivered reports** and apply strict rules before minting.

---

## Why BOBC uses CRE

BOBC issuance depends on **off-chain facts** that cannot be sourced trustlessly on-chain without an oracle-style bridge, such as:

* the current **bank/reserve balance** (Proof-of-Reserves signal),
* which purchase orders are **approved** after verification (KYC/receipt/bank confirmation).

CRE is used as the project’s **automation + oracle execution layer** to:

1. **Fetch off-chain state reliably** (HTTP APIs)
2. **Package that state as an authenticated report**
3. **Deliver it on-chain** through the CRE forwarder to the receiver
4. Enable a workflow that is **repeatable**, **auditable**, and **cleanly separated** from business logic

This makes CRE the glue that turns off-chain verification into **enforceable on-chain actions**, without putting sensitive verification steps on-chain.

---

## What CRE is responsible for in BOBC

### CRE’s job (high level)

CRE does **not** decide who gets minted or how much.
CRE **transports** a batch snapshot of off-chain truth to the chain in a structured way:

* **Reserve state**: “What is the bank/reserve balance right now?”
* **Approval state**: “Which order IDs are approved to mint now?”

### The receiver’s job (on-chain)

The receiver contract (`CRE_BOBC`) performs all enforcement:

* verifies the reserve delta matches the batch mint sum,
* verifies each order is valid and pending,
* mints only if the invariant holds,
* emits a batch event to synchronize the off-chain system.

This separation is intentional: **CRE provides trustworthy delivery; the contract provides deterministic enforcement.**

---

## Off-chain sources CRE reads

BOBC exposes an HTTP endpoint that CRE reads, producing a canonical “batch mint snapshot”.

### Primary endpoint: `/batch`

CRE reads a single endpoint that returns two pieces of information:

1. **`bankBalance`** — integer reserve/bank balance (fiat units, no decimals)
2. **`approvedIds`** — array of order IDs approved for minting

Example response shape:

```json id="6mehpv"
{
  "bankBalance": 1500,
  "approvedIds": [1, 2]
}
```

**Semantics**

* `bankBalance` is the current “source of truth” reserve signal.
* `approvedIds` is the set of orders cleared by off-chain verification and eligible to mint.

> This design keeps complex verification off-chain (receipts, bank confirmation, compliance checks) while still allowing deterministic enforcement on-chain.

---

## What CRE writes on-chain

CRE writes a report to the receiver contract containing:

1. **`bankBalanceScaled`** — `bankBalance` scaled to 18 decimals (EVM-friendly precision)
2. **`approvedIds`** — the approved order IDs to be minted in the batch

### Report payload encoding

The report body is encoded as:

```solidity id="g31pv9"
abi.encode(uint256 bankBalanceScaled, uint256[] approvedIds)
```

Where:

* `bankBalanceScaled = bankBalance * 10^18`

The receiver decodes it as:

```solidity id="owgwc2"
(uint256 bankBalanceScaled, uint256[] memory ids) = abi.decode(report, (uint256, uint256[]));
```

---

## How CRE triggers minting (the actual flow)

Below is the exact logic chain reviewers should understand:

1. **Off-chain system updates state**

   * Approves certain orders (IDs) after verification
   * Updates the bank balance signal (PoR)

2. **CRE workflow reads `/batch`**

   * Fetches `{ bankBalance, approvedIds }`
   * Validates schema / types (sanity checks)
   * Scales bankBalance → `bankBalanceScaled`

3. **CRE workflow writes a report to Sepolia**

   * Sends the ABI-encoded payload to the receiver:

     * `CRE_BOBC.onReport(metadata, report)`

4. **Receiver contract enforces the invariant before minting**

   * Computes:

     * `delta = bankBalanceScaled - lastProcessedBankBalance`
     * `sum = Σ(order.amount for id in approvedIds)`
   * Requires:

     * `delta == sum`
   * If it matches, mints the batch and advances the pointer:

     * `lastProcessedBankBalance = bankBalanceScaled`

5. **Receiver emits a single batch event**

   * `BatchMinted(uint256[] orderIds)`
   * This is intended for off-chain consumption so the API/backend can “consume” approvals (turn them off) only after successful mint.

This is how CRE is “used correctly” here: **CRE delivers off-chain truth; the on-chain receiver deterministically enforces it.**

---

## Why the “delta pointer” model matters (and why CRE is a good fit)

The system uses a pointer:

* `lastProcessedBankBalance`

instead of comparing against token `totalSupply`. This is important for correctness and replay safety:

* CRE reports a *current balance snapshot*.
* The contract only mints the *difference* between this snapshot and the last processed snapshot.
* That difference must equal the batch sum exactly.

This achieves:

* **no double-counting** (you can’t mint twice off the same reserve increase),
* **clean batching** (each report consumes exactly one delta),
* strong coupling between off-chain reserve changes and on-chain issuance.

CRE is well-suited to this because it can **reliably fetch** and **publish** these snapshots on a schedule, without embedding bank integration logic on-chain.

---

## How approvals are handled via CRE (and why)

Approvals live off-chain because they depend on:

* receipt validation,
* bank transfer reconciliation,
* operational/compliance logic,
* potential manual review.

CRE is used to:

* bring the “approved set” on-chain for the specific batch,
* in the same report as the reserve snapshot.

This is crucial: it binds **the approvals list** to **the reserve snapshot** that must reconcile against that list. That coupling is what provides BOBC’s “double safety” gate.

---

## Key properties reviewers can verify on-chain

From the Sepolia contract at:

* `0x87ba13aF77c9c37aBa42232B4C625C066a433eeE`

Reviewers can inspect:

* `onReport` decoding shape: `(uint256, uint256[])`
* pointer logic: `lastProcessedBankBalance`
* batch enforcement: `delta == sum`
* batch event: `BatchMinted(orderIds)`
* order states: `Pending → Minted`

These are the on-chain enforcement pieces that make the CRE-fed data actionable and safe.

---

## Summary

BOBC uses Chainlink CRE as:

* an **oracle execution and automation layer** that fetches off-chain reserve/approval state,
* packages it as a deterministic report payload,
* delivers it to an on-chain receiver contract,
* enabling **batch issuance** that is **strictly constrained** by PoR reconciliation and approval gating.

The contract enforces correctness; CRE provides reliable off-chain data delivery.
