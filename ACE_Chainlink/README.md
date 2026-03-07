# BOBC — Digital Boliviano Stablecoin

ERC-20 stablecoin pegged 1:1 to the Bolivian Boliviano (Bs), with KYC compliance enforced on-chain via a Chainlink ACE-compatible registry and Chainlink CRE as the fiat-to-blockchain minting bridge.

---

## The Problem

Bolivia has been on the FATF grey list since 2020. Bolivians cannot access DeFi, and banks spend millions on manual KYC/AML. No stablecoin enforces Bolivian regulatory rules on-chain — until now.

---

## System Overview

```
  User
   │ wallet + KYC form
   ▼
  Frontend (React/Wagmi)
   │ REST
   ▼
  Backend (Node.js)  ◄──── Agent loop (30s) ◄──── Claude LLM + Gemini Vision
   │ viem
   ├──► CCIDRegistry     — Chainlink ACE-compatible identity registry
   ├──► PolicyManager    — compliance rules (KYC limits, sanctions, anti-smurfing)
   └──► CRE_BOBC         — Chainlink CRE receiver contract
             │ onReport()
             └──► StablecoinBOBC.mint()
```

---

## How Chainlink ACE is Used

ACE provides the on-chain identity and compliance layer. In this MVP, **CCIDRegistry** and **PolicyManager** are ACE-compatible mocks — they implement the same interfaces and can be swapped for Chainlink ACE production contracts without changing the token.

### CCIDRegistry (Identity)

Every wallet that wants to hold or transfer BOBC must be registered in `CCIDRegistry`. The agent calls `registerIdentity()` after AI-based KYC approval:

```solidity
CCIDRegistry.registerIdentity(wallet, tier, credentialHash)
// credentialHash = keccak256(abi.encodePacked(wallet, ci))
// tier: 1=KYC1 (Bs 5,000/day), 2=KYC2 (Bs 34,000/day), 3=KYC3 (Bs 500,000/day)
// expires after 365 days
```

### PolicyManager (Compliance Hook)

Every ERC-20 transfer, mint, and burn goes through `StablecoinBOBC._update()`:

```solidity
function _update(address from, address to, uint256 amount) internal override {
    policyManager.checkTransfer(from, to, amount);   // revert if non-compliant
    super._update(from, to, amount);
    policyManager.recordTransfer(from, to, amount);  // anti-smurfing + UIF tracking
}
```

`checkTransfer` enforces: valid CCID on both sides, daily KYC tier limit, no frozen/sanctioned wallets, anti-smurfing (5 tx/hour cooldown), and auto `UIFReport` event for amounts >= Bs 34,500.

### Migration to ACE Production

```solidity
StablecoinBOBC.updateCompliance(aceRealAddress)
// 48-hour timelock → then:
StablecoinBOBC.executePolicyManagerUpdate()
```

The token never changes — only the compliance engine address.

---

## How Chainlink CRE is Used

CRE bridges Boliviano bank deposits to on-chain minting. The flow has three actors: the AI agent, the backend `/batch` endpoint, and the CRE_BOBC contract.

### CRE_BOBC Contract

`CRE_BOBC` implements the Chainlink CRE `IReceiver` interface:

```solidity
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
```

`onReport` is called by the Chainlink CRE forwarder after reading the `/batch` data feed. It validates that the bank balance delta matches the sum of the approved order amounts, then mints:

```solidity
function onReport(bytes calldata, bytes calldata report) external onlyForwarder {
    (uint256 bankBalanceScaled, uint256[] memory ids) = abi.decode(report, (uint256, uint256[]));

    uint256 delta = bankBalanceScaled - lastProcessedBankBalance;
    uint256 sum = 0;
    for (uint256 i = 0; i < ids.length; i++) {
        sum += orders[ids[i]].amount;
    }
    if (delta != sum) revert DeltaMismatch(delta, sum);  // proof of reserves check

    for (uint256 i = 0; i < ids.length; i++) {
        orders[ids[i]].status = Status.Minted;
        token.mint(orders[ids[i]].recipient, orders[ids[i]].amount);
    }
    emit BatchMinted(ids);
    lastProcessedBankBalance = bankBalanceScaled;
}
```

### /batch Data Feed

The CRE job polls `GET /batch` every 10 seconds to decide what to report:

```json
{ "bankBalance": 100, "approvedIds": [1, 2] }
```

- `bankBalance` — total Bolivianos held in the custodian bank account
- `approvedIds` — on-chain order IDs (assigned by `CRE_BOBC.createOrder()`) ready to be minted

### Order Lifecycle

```
Agent validates receipt
       │
       ▼
POST /admin/cre/create-order
  → CRE_BOBC.createOrder(recipient, amount)   [on-chain, OPERATOR_ROLE]
  → returns orderId (contract-assigned, sequential)
       │
       ▼
/batch returns approvedIds: [orderId]
       │
       ▼
CRE calls onReport(bankBalanceScaled, [orderId])
  → delta == order.amount → mint ✅
       │
       ▼
BatchMinted event → watcher → SQLite status = 'minted' → frontend updates
```

---

## KYC Flow (Agent + ACE)

### Step-by-step

1. User submits name, CI (national ID), and wallet address via the frontend
2. Backend stores the request in SQLite with `status = 'pending'`
3. The agent loop (every 30s) calls `GET /admin/pending` — if KYC requests exist, it sends them to Claude
4. Claude evaluates name completeness and CI format, then calls `approve_kyc` or `reject_kyc`
5. On approval: backend computes `credentialHash = keccak256(wallet, ci)` and calls `CCIDRegistry.registerIdentity()` on Sepolia
6. SQLite updated with `status = 'approved'` and the on-chain `tx_hash`
7. Frontend polling detects `approved` → shows Etherscan link → redirects to buy form

On rejection: SQLite updated with reason, no on-chain tx. User can resubmit — backend does an UPSERT from `rejected` back to `pending`.

### Receipt Validation (Gemini Vision)

For deposit receipts, the agent uses Gemini Vision instead of Claude (image analysis):

```
Gemini receives: receipt image + expected amount + expected reference code
Gemini returns: { monto_coincide, referencia_coincide, aprobado, razon }
```

If approved: agent calls `confirm_deposit` then `cre_create_order`.
If rejected: backend marks order `status = 'rejected'` with reason. Frontend shows the rejection message and offers a retry.

---

## Contracts (Sepolia)

| Contract | Address | Verified |
|----------|---------|----------|
| StablecoinBOBC | `0xf132Ba93754206DF89E61B43A9800498B7062C13` | ✅ |
| PolicyManager | `0x1C57A01B0e1F95848b22f31e8F90E9B07728DfE9` | ✅ |
| CCIDRegistry | `0x9968C2C127d3d88DE61c87050aE3Ef398EaF9719` | ✅ |
| CRE_BOBC | `0x87ba13aF77c9c37aBa42232B4C625C066a433eeE` | — |

---

Built for Chainlink Hackathon 2026
