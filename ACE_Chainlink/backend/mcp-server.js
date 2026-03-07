/**
 * mcp-server.js — MCP Server with 14 tools for BOBC Stablecoin Agent
 *
 * Transport: SSE over HTTP (port MCP_PORT) + stdio fallback
 *
 * Tools:
 *   Bank API (offchain mock):
 *     1. confirm_deposit
 *     2. get_reserves_balance
 *     3. execute_bank_transfer
 *     4. get_transaction_status
 *     5. verify_account_ownership
 *     6. link_wallet_to_account
 *     7. generate_uif_report
 *     8. get_account_history
 *
 *   Contract Admin (onchain via chain.js):
 *     9.  register_identity
 *     10. revoke_identity
 *     11. link_bank_account
 *     12. freeze_wallet
 *     13. unfreeze_wallet
 *     14. add_to_sanctions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { z } from 'zod';

import {
  auditLog,
  getBankBalance,
  addBankBalance,
  confirmOrder,
  getOrdersByWallet,
  updateOrderStatus,
  createWalletLink,
  getWalletLink,
  getWalletLinkByAccount,
  isRedeemProcessed,
  markRedeemProcessed,
  markOwnershipVerified,
  isOwnershipVerified,
  updateKycStatus,
  getKycByWallet,
  getOrderById,
} from './db.js';

import {
  ccidIsValid,
  ccidGetTier,
  ccidGetIdentity,
  policyIsFrozen,
  policyIsSanctioned,
  registerIdentity as chainRegisterIdentity,
  revokeIdentity as chainRevokeIdentity,
  freezeWallet as chainFreezeWallet,
  unfreezeWallet as chainUnfreezeWallet,
  addToSanctions as chainAddToSanctions,
  mintTokens as chainMintTokens,
  TIER_MAP,
  TIER_NAME_MAP,
  computeCredentialHash,
} from './chain.js';

const MCP_PORT = Number(process.env.MCP_PORT) || 3002;

// ─── Mock ID generators ───────────────────────────────────────────────────────

let _depositSeq = 100042;
let _transferSeq = 42;
let _linkSeq = 15;
let _reportSeq = 3;
let _auditSeq = 789;
let _nonceSeq = 100042;

const nextNonce = () => ++_nonceSeq;
const nextTransferId = () => `TRF-2026-${String(++_transferSeq).padStart(5, '0')}`;
const nextLinkId = () => `LNK-2026-${String(++_linkSeq).padStart(5, '0')}`;
const nextReportId = () => `UIF-2026-${String(++_reportSeq).padStart(5, '0')}`;
const nextAuditId = () => `AUDIT-2026-${String(++_auditSeq).padStart(5, '0')}`;
const mockHmac = () => Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 14);
const nowIso = () => new Date().toISOString();

// ─── Error helper ─────────────────────────────────────────────────────────────

function mcpError(code, message) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

function mcpOk(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  // ── Bank API tools ──────────────────────────────────────────────────────────
  {
    name: 'confirm_deposit',
    description:
      'Confirms and records an incoming fiat deposit. First step of the mint flow. The CRE then mints tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        txId: {
          type: 'string',
          description: 'Bank transaction ID. Format: DEP-YYYY-NNNNN',
        },
        userId: {
          type: 'string',
          description: 'User ID in bank system. Format: USR-BOL-NNNNN',
        },
        amount: {
          type: 'number',
          description: 'Deposit amount in Bolivianos (BOB). Must be > 0.',
        },
        currency: {
          type: 'string',
          enum: ['BOB'],
          description: 'Must be BOB',
        },
        bankAccountId: {
          type: 'string',
          description: 'Source bank account ID. Format: ACCT-*',
        },
      },
      required: ['txId', 'userId', 'amount', 'currency', 'bankAccountId'],
    },
  },
  {
    name: 'get_reserves_balance',
    description:
      'Returns the current balance of the custodial bank account backing all BOB tokens. Used by CRE for Proof of Reserves.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Custodial account ID. Defaults to ACCT-001-CUSTODIA.',
        },
      },
      required: [],
    },
  },
  {
    name: 'execute_bank_transfer',
    description:
      'Executes an outgoing bank transfer to send Bolivianos to a user during token redemption.',
    inputSchema: {
      type: 'object',
      properties: {
        redeemId: {
          type: 'string',
          description: 'Redemption ID from onchain RedeemRequested event.',
        },
        bankAccountId: {
          type: 'string',
          description: 'Destination bank account ID.',
        },
        amount: {
          type: 'number',
          description: 'Amount to transfer in BOB.',
        },
        currency: {
          type: 'string',
          enum: ['BOB'],
        },
        reference: {
          type: 'string',
          description: 'Optional reference string for the bank.',
        },
      },
      required: ['redeemId', 'bankAccountId', 'amount', 'currency'],
    },
  },
  {
    name: 'get_transaction_status',
    description:
      'Queries the current status of a bank transaction (deposit DEP-* or transfer TRF-*).',
    inputSchema: {
      type: 'object',
      properties: {
        transactionId: {
          type: 'string',
          description: 'Bank transaction ID (DEP-* or TRF-*).',
        },
      },
      required: ['transactionId'],
    },
  },
  {
    name: 'verify_account_ownership',
    description:
      'Verifies that a bank account belongs to a specific user. Must be called before link_wallet_to_account.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID in bank system.' },
        bankAccountId: { type: 'string', description: 'Bank account ID to verify.' },
      },
      required: ['userId', 'bankAccountId'],
    },
  },
  {
    name: 'link_wallet_to_account',
    description:
      'Creates an offchain record in the bank linking a wallet address to a bank account. Call after verify_account_ownership.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        bankAccountId: { type: 'string' },
        walletAddress: {
          type: 'string',
          description: 'Base blockchain wallet address (0x...)',
        },
      },
      required: ['userId', 'bankAccountId', 'walletAddress'],
    },
  },
  {
    name: 'generate_uif_report',
    description:
      'Files a Suspicious Activity Report (SAR) with the UIF (Bolivia financial intelligence unit). Compliance-critical.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        walletAddress: { type: 'string' },
        reason: {
          type: 'string',
          enum: [
            'HIGH_FREQUENCY_TRANSACTIONS',
            'AMOUNT_EXCEEDS_THRESHOLD',
            'STRUCTURING_DETECTED',
            'SANCTIONED_INTERACTION',
            'MANUAL_FLAG',
          ],
        },
        transactionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related transaction IDs (DEP-* or TRF-*)',
        },
        additionalNotes: { type: 'string' },
      },
      required: ['userId', 'walletAddress', 'reason', 'transactionIds'],
    },
  },
  {
    name: 'get_account_history',
    description:
      'Retrieves transaction history for a bank account. Used for auditing and compliance.',
    inputSchema: {
      type: 'object',
      properties: {
        bankAccountId: { type: 'string' },
        fromDate: { type: 'string', description: 'YYYY-MM-DD' },
        toDate: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
        offset: { type: 'integer', default: 0, minimum: 0 },
      },
      required: ['bankAccountId'],
    },
  },

  // ── Contract Admin tools (onchain) ──────────────────────────────────────────
  {
    name: 'register_identity',
    description:
      'Registers a KYC-verified identity on CCIDRegistry onchain. Required for users to mint, transfer, and redeem tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: {
          type: 'string',
          description: "User's wallet address on Base",
        },
        tier: {
          type: 'string',
          enum: ['KYC1', 'KYC2', 'KYC3'],
          description: 'KYC level completed by the bank',
        },
        credentialHash: {
          type: 'string',
          description:
            'keccak256 hash of identity document (0x...64 hex chars). If omitted and ci provided, will be computed.',
        },
        ci: {
          type: 'string',
          description: 'CI number — used to compute credentialHash if not provided directly.',
        },
      },
      required: ['wallet', 'tier'],
    },
  },
  {
    name: 'revoke_identity',
    description:
      'Revokes a user identity from CCIDRegistry onchain. User loses ability to mint/transfer/redeem.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string' },
        reason: {
          type: 'string',
          enum: [
            'fraud_detected',
            'user_request',
            'document_expired',
            'regulatory_order',
            'deceased',
            'duplicate_identity',
          ],
        },
        internalConfirmation: {
          type: 'boolean',
          description: 'Must be true to confirm the action.',
        },
      },
      required: ['wallet', 'reason', 'internalConfirmation'],
    },
  },
  {
    name: 'link_bank_account',
    description:
      'Links a wallet to a bank account on RedeemContract onchain. Required for token redemption.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string' },
        bankAccountId: { type: 'string' },
      },
      required: ['wallet', 'bankAccountId'],
    },
  },
  {
    name: 'freeze_wallet',
    description:
      'Freezes a wallet on PolicyManager, blocking all token operations. Compliance-critical action.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string' },
        reason: {
          type: 'string',
          enum: ['fraud_detected', 'regulatory_order', 'aml_flag', 'court_order'],
        },
        evidence: {
          type: 'string',
          description: 'Reference to supporting evidence (UIF report ID, etc.)',
        },
      },
      required: ['wallet', 'reason'],
    },
  },
  {
    name: 'unfreeze_wallet',
    description:
      'Unfreezes a wallet on PolicyManager after resolution. Cannot unfreeze sanctioned wallets.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string' },
        reason: {
          type: 'string',
          description: 'Justification for unfreezing.',
        },
        resolutionReference: {
          type: 'string',
          description: 'Reference to resolution document.',
        },
      },
      required: ['wallet', 'reason'],
    },
  },
  {
    name: 'add_to_sanctions',
    description:
      'Adds a wallet to the sanctions list on PolicyManager. IRREVERSIBLE by agent — only ADMIN_ROLE multisig can remove.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string' },
        reason: { type: 'string' },
        authority: {
          type: 'string',
          enum: ['OFAC', 'UIF_BOLIVIA', 'INTERNAL'],
        },
        referenceDocument: {
          type: 'string',
          description: 'Reference number of sanctions order or investigation report.',
        },
      },
      required: ['wallet', 'reason', 'authority'],
    },
  },
  // ── 15. emergency_mint (no CRE fallback) ─────────────────────────────────
  {
    name: 'emergency_mint',
    description:
      'FALLBACK: Mints BOBC tokens directly to a wallet when CRE is not active. ' +
      'Use ONLY after confirming the bank deposit. When CRE is live, it handles minting automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string', description: 'Recipient wallet address' },
        amount_bs: { type: 'number', description: 'Amount in BOB to mint (1 BOB = 1 BOBC)' },
        orderId: { type: 'number', description: 'Order ID being fulfilled' },
      },
      required: ['wallet', 'amount_bs', 'orderId'],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function handleTool(name, args) {
  // Log every invocation
  auditLog(`mcp_tool_${name}`, args, null);

  try {
    switch (name) {
      case 'confirm_deposit':
        return await toolConfirmDeposit(args);
      case 'get_reserves_balance':
        return await toolGetReservesBalance(args);
      case 'execute_bank_transfer':
        return await toolExecuteBankTransfer(args);
      case 'get_transaction_status':
        return await toolGetTransactionStatus(args);
      case 'verify_account_ownership':
        return await toolVerifyAccountOwnership(args);
      case 'link_wallet_to_account':
        return await toolLinkWalletToAccount(args);
      case 'generate_uif_report':
        return await toolGenerateUifReport(args);
      case 'get_account_history':
        return await toolGetAccountHistory(args);
      case 'register_identity':
        return await toolRegisterIdentity(args);
      case 'revoke_identity':
        return await toolRevokeIdentity(args);
      case 'link_bank_account':
        return await toolLinkBankAccount(args);
      case 'freeze_wallet':
        return await toolFreezeWallet(args);
      case 'unfreeze_wallet':
        return await toolUnfreezeWallet(args);
      case 'add_to_sanctions':
        return await toolAddToSanctions(args);
      case 'emergency_mint':
        return await toolEmergencyMint(args);
      default:
        return mcpError('UNKNOWN_TOOL', `Tool ${name} not found`);
    }
  } catch (err) {
    console.error(`[mcp-server] tool ${name} error:`, err);
    auditLog(`mcp_tool_${name}_error`, args, { error: err.message });
    return mcpError(err.code || 'INTERNAL_ERROR', err.message);
  }
}

// ── 1. confirm_deposit ───────────────────────────────────────────────────────

async function toolConfirmDeposit({ txId, userId, amount, currency, bankAccountId, orderId }) {
  // Validations
  if (!txId || !/^DEP-\d{4}-\d{5,}$/.test(txId)) {
    return mcpError('INVALID_TX_ID', 'txId must match DEP-YYYY-NNNNN');
  }
  if (!amount || amount <= 0) {
    return mcpError('INVALID_AMOUNT', 'amount must be > 0');
  }
  if (currency !== 'BOB') {
    return mcpError('INVALID_CURRENCY', 'currency must be BOB');
  }
  if (!userId || userId.trim() === '') {
    return mcpError('INVALID_USER_ID', 'userId is required');
  }
  if (!bankAccountId || bankAccountId.trim() === '') {
    return mcpError('INVALID_ACCOUNT', 'bankAccountId is required');
  }

  // Add to bank balance
  addBankBalance(amount);

  // If orderId provided, mark the order as confirmed so it appears in /batch approvedIds
  if (orderId) {
    confirmOrder(orderId, amount);
  }

  const result = {
    success: true,
    depositId: txId,
    orderId: orderId || null,
    status: 'CONFIRMED',
    timestamp: nowIso(),
    signature: mockHmac(),
    nonce: nextNonce(),
  };

  auditLog('confirm_deposit_result', { txId, userId, amount, orderId }, result);
  return mcpOk(result);
}

// ── 2. get_reserves_balance ──────────────────────────────────────────────────

async function toolGetReservesBalance({ accountId } = {}) {
  const acctId = accountId || 'ACCT-001-CUSTODIA';
  const balance = getBankBalance();

  const result = {
    accountId: acctId,
    balance,
    currency: 'BOB',
    timestamp: nowIso(),
    signature: mockHmac(),
    nonce: nextNonce(),
  };

  auditLog('get_reserves_balance_result', { accountId: acctId }, { balance });
  return mcpOk(result);
}

// ── 3. execute_bank_transfer ─────────────────────────────────────────────────

async function toolExecuteBankTransfer({ redeemId, bankAccountId, amount, currency, reference }) {
  if (!redeemId || redeemId.trim() === '') {
    return mcpError('INVALID_REDEEM_ID', 'redeemId is required');
  }
  if (!amount || amount <= 0) {
    return mcpError('INVALID_AMOUNT', 'amount must be > 0');
  }
  if (currency !== 'BOB') {
    return mcpError('INVALID_CURRENCY', 'currency must be BOB');
  }
  if (!bankAccountId || bankAccountId.trim() === '') {
    return mcpError('INVALID_ACCOUNT', 'bankAccountId is required');
  }

  // Idempotency check
  if (isRedeemProcessed(redeemId)) {
    return mcpError('DUPLICATE_REDEEM', 'redeemId already processed');
  }

  const transferId = nextTransferId();
  const estimatedCompletion = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  markRedeemProcessed(redeemId, transferId);

  const result = {
    success: true,
    transferId,
    status: 'INITIATED',
    estimatedCompletion,
    signature: mockHmac(),
    nonce: nextNonce(),
  };

  auditLog('execute_bank_transfer_result', { redeemId, bankAccountId, amount }, result);
  return mcpOk(result);
}

// ── 4. get_transaction_status ────────────────────────────────────────────────

async function toolGetTransactionStatus({ transactionId }) {
  if (!transactionId || transactionId.trim() === '') {
    return mcpError('INVALID_TX_ID', 'transactionId is required');
  }

  // Mock: simulate different statuses based on ID pattern
  const isDeposit = transactionId.startsWith('DEP-');
  const isTransfer = transactionId.startsWith('TRF-');

  if (!isDeposit && !isTransfer) {
    return mcpError('TRANSACTION_NOT_FOUND', 'transactionId not recognized');
  }

  const result = {
    transactionId,
    type: isDeposit ? 'DEPOSIT' : 'TRANSFER',
    status: 'COMPLETED',
    amount: 0,
    currency: 'BOB',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  auditLog('get_transaction_status_result', { transactionId }, result);
  return mcpOk(result);
}

// ── 5. verify_account_ownership ─────────────────────────────────────────────

async function toolVerifyAccountOwnership({ userId, bankAccountId }) {
  if (!userId || userId.trim() === '') {
    return mcpError('INVALID_USER_ID', 'userId is required');
  }
  if (!bankAccountId || bankAccountId.trim() === '') {
    return mcpError('INVALID_ACCOUNT', 'bankAccountId is required');
  }

  // Mock: always verified if both IDs are non-empty
  markOwnershipVerified(userId, bankAccountId);

  const result = {
    verified: true,
    userId,
    bankAccountId,
    accountHolder: 'Usuario V****do',
    accountStatus: 'ACTIVE',
  };

  auditLog('verify_account_ownership_result', { userId, bankAccountId }, result);
  return mcpOk(result);
}

// ── 6. link_wallet_to_account ────────────────────────────────────────────────

async function toolLinkWalletToAccount({ userId, bankAccountId, walletAddress }) {
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return mcpError('INVALID_WALLET', 'walletAddress must be a valid 0x address');
  }
  if (!userId || userId.trim() === '') {
    return mcpError('INVALID_USER_ID', 'userId is required');
  }
  if (!bankAccountId || bankAccountId.trim() === '') {
    return mcpError('INVALID_ACCOUNT', 'bankAccountId is required');
  }

  // Check ownership was verified
  if (!isOwnershipVerified(userId, bankAccountId)) {
    return mcpError('OWNERSHIP_NOT_VERIFIED', 'Call verify_account_ownership first');
  }

  // Check for existing links
  const existingByWallet = getWalletLink(walletAddress);
  if (existingByWallet && existingByWallet.bank_account_id !== bankAccountId) {
    return mcpError('WALLET_ALREADY_LINKED', 'Wallet already linked to another account');
  }
  const existingByAccount = getWalletLinkByAccount(bankAccountId);
  if (existingByAccount && existingByAccount.wallet !== walletAddress.toLowerCase()) {
    return mcpError('ACCOUNT_ALREADY_LINKED', 'Account already has a wallet linked');
  }

  const linkId = nextLinkId();
  const linkedAt = nowIso();

  createWalletLink({ wallet: walletAddress, bankAccountId, userId, linkId });

  const result = {
    success: true,
    linkId,
    userId,
    bankAccountId,
    walletAddress,
    linkedAt,
  };

  auditLog('link_wallet_to_account_result', { userId, bankAccountId, walletAddress }, result);
  return mcpOk(result);
}

// ── 7. generate_uif_report ───────────────────────────────────────────────────

async function toolGenerateUifReport({ userId, walletAddress, reason, transactionIds, additionalNotes }) {
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return mcpError('INVALID_WALLET', 'walletAddress must be a valid 0x address');
  }
  if (!userId || userId.trim() === '') {
    return mcpError('INVALID_USER_ID', 'userId is required');
  }
  if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
    return mcpError('INVALID_TX_IDS', 'transactionIds must be a non-empty array');
  }

  const validReasons = [
    'HIGH_FREQUENCY_TRANSACTIONS',
    'AMOUNT_EXCEEDS_THRESHOLD',
    'STRUCTURING_DETECTED',
    'SANCTIONED_INTERACTION',
    'MANUAL_FLAG',
  ];
  if (!validReasons.includes(reason)) {
    return mcpError('INVALID_REASON', `reason must be one of: ${validReasons.join(', ')}`);
  }

  const reportId = nextReportId();
  const referenceNumber = `UIF-REF-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
  const filedAt = nowIso();

  const result = {
    success: true,
    reportId,
    status: 'FILED',
    filedAt,
    referenceNumber,
  };

  auditLog('generate_uif_report_result', {
    userId,
    walletAddress,
    reason,
    transactionIds,
    additionalNotes,
  }, result);

  return mcpOk(result);
}

// ── 8. get_account_history ───────────────────────────────────────────────────

async function toolGetAccountHistory({ bankAccountId, fromDate, toDate, limit = 50, offset = 0 }) {
  if (!bankAccountId || bankAccountId.trim() === '') {
    return mcpError('INVALID_ACCOUNT', 'bankAccountId is required');
  }

  const clampedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const clampedOffset = Math.max(Number(offset) || 0, 0);

  // Validate date range if both provided
  if (fromDate && toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const diffDays = (to - from) / (1000 * 60 * 60 * 24);
    if (diffDays > 90) {
      return mcpError('DATE_RANGE_TOO_WIDE', 'Date range must be <= 90 days');
    }
  }

  // Return orders for any wallet linked to this account as mock history
  const link = getWalletLinkByAccount(bankAccountId);
  let transactions = [];

  if (link) {
    const orders = getOrdersByWallet(link.wallet);
    transactions = orders.slice(clampedOffset, clampedOffset + clampedLimit).map(o => ({
      transactionId: o.reference || `DEP-${o.id}`,
      type: 'DEPOSIT',
      amount: o.amount_bs,
      currency: 'BOB',
      status: o.status === 'confirmed' || o.status === 'minted' ? 'COMPLETED' : 'PENDING',
      reference: o.reference,
      timestamp: new Date(o.created_at * 1000).toISOString(),
    }));
  }

  const result = {
    bankAccountId,
    transactions,
    totalCount: transactions.length,
    hasMore: false,
  };

  auditLog('get_account_history_result', { bankAccountId }, { totalCount: result.totalCount });
  return mcpOk(result);
}

// ── 9. register_identity ─────────────────────────────────────────────────────

async function toolRegisterIdentity({ wallet, tier, credentialHash, ci }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return mcpError('INVALID_WALLET', 'wallet must be a valid 0x address');
  }
  if (!TIER_MAP[tier]) {
    return mcpError('INVALID_TIER', 'tier must be KYC1, KYC2, or KYC3');
  }

  // Compute credentialHash if not provided
  let hash = credentialHash;
  if (!hash) {
    if (!ci) {
      return mcpError('MISSING_CREDENTIAL', 'credentialHash or ci is required');
    }
    hash = computeCredentialHash(wallet, ci);
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    return mcpError('INVALID_CREDENTIAL_HASH', 'credentialHash must be a 0x-prefixed 32-byte hex string');
  }

  // Pre-check: is identity already registered?
  const isValid = await ccidIsValid(wallet);
  if (isValid) {
    return mcpError('WALLET_ALREADY_REGISTERED', 'Wallet already has an active identity');
  }

  // Log before sending tx (audit trail)
  auditLog('register_identity_pre_tx', { wallet, tier, credentialHash: hash }, null);

  const txHash = await chainRegisterIdentity(wallet, tier, hash);

  // Update SQLite so the agent sees this as approved (not pending forever)
  const tierNum = TIER_MAP[tier];
  updateKycStatus(wallet, 'approved', tierNum, null);

  const result = {
    success: true,
    wallet,
    tier,
    txHash,
    registeredAt: nowIso(),
  };

  auditLog('register_identity_result', { wallet, tier }, result);
  return mcpOk(result);
}

// ── 10. revoke_identity ──────────────────────────────────────────────────────

async function toolRevokeIdentity({ wallet, reason, internalConfirmation }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return mcpError('INVALID_WALLET', 'wallet must be a valid 0x address');
  }
  if (!internalConfirmation) {
    return mcpError('CONFIRMATION_REQUIRED', 'internalConfirmation must be true');
  }

  const validReasons = [
    'fraud_detected',
    'user_request',
    'document_expired',
    'regulatory_order',
    'deceased',
    'duplicate_identity',
  ];
  if (!validReasons.includes(reason)) {
    return mcpError('INVALID_REASON', `reason must be one of: ${validReasons.join(', ')}`);
  }

  // Pre-check
  const isValid = await ccidIsValid(wallet);
  if (!isValid) {
    return mcpError('WALLET_NOT_REGISTERED', 'No active identity found for this wallet');
  }

  // Get tier before revoking for audit trail
  const tierNum = await ccidGetTier(wallet);
  const previousTier = TIER_NAME_MAP[tierNum] || 'UNKNOWN';

  // Log before tx
  auditLog('revoke_identity_pre_tx', { wallet, reason, previousTier }, null);

  const txHash = await chainRevokeIdentity(wallet);

  // Update SQLite to reflect revocation
  updateKycStatus(wallet, 'rejected', null, reason);

  const result = {
    success: true,
    wallet,
    reason,
    txHash,
    revokedAt: nowIso(),
    previousTier,
  };

  auditLog('revoke_identity_result', { wallet, reason }, result);
  return mcpOk(result);
}

// ── 11. link_bank_account ────────────────────────────────────────────────────

async function toolLinkBankAccount({ wallet, bankAccountId }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return mcpError('INVALID_WALLET', 'wallet must be a valid 0x address');
  }
  if (!bankAccountId || bankAccountId.trim() === '') {
    return mcpError('INVALID_ACCOUNT', 'bankAccountId is required');
  }

  // Pre-check: wallet must have identity
  const isValid = await ccidIsValid(wallet);
  if (!isValid) {
    return mcpError('WALLET_NOT_REGISTERED', 'Wallet must have a registered identity (call register_identity first)');
  }

  // Log that we're linking onchain — RedeemContract.linkBankAccount not available
  // in the provided contracts, so we log to audit and store in SQLite
  auditLog('link_bank_account_pre_tx', { wallet, bankAccountId }, null);

  // Store in local DB as the onchain link record
  createWalletLink({ wallet, bankAccountId, userId: null, linkId: null });

  // NOTE: If RedeemContract is deployed and address provided, call linkBankAccount()
  // For now: record offchain and return success (RedeemContract ABI not in scope)
  const result = {
    success: true,
    wallet,
    bankAccountId,
    txHash: null, // Would be set if RedeemContract address configured
    linkedAt: nowIso(),
    note: 'Recorded locally. Deploy RedeemContract and set REDEEM_CONTRACT_ADDRESS for onchain link.',
  };

  auditLog('link_bank_account_result', { wallet, bankAccountId }, result);
  return mcpOk(result);
}

// ── 12. freeze_wallet ────────────────────────────────────────────────────────

async function toolFreezeWallet({ wallet, reason, evidence }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return mcpError('INVALID_WALLET', 'wallet must be a valid 0x address');
  }

  const validReasons = ['fraud_detected', 'regulatory_order', 'aml_flag', 'court_order'];
  if (!validReasons.includes(reason)) {
    return mcpError('INVALID_REASON', `reason must be one of: ${validReasons.join(', ')}`);
  }

  // Pre-check
  const isFrozen = await policyIsFrozen(wallet);
  if (isFrozen) {
    return mcpError('WALLET_ALREADY_FROZEN', 'Wallet is already frozen');
  }

  // Log before tx (audit trail preserved even if tx fails)
  const auditId = nextAuditId();
  auditLog('freeze_wallet_pre_tx', { wallet, reason, evidence, auditId }, null);

  const txHash = await chainFreezeWallet(wallet);

  const result = {
    success: true,
    wallet,
    reason,
    txHash,
    frozenAt: nowIso(),
    auditLogId: auditId,
  };

  auditLog('freeze_wallet_result', { wallet, reason }, result);
  return mcpOk(result);
}

// ── 13. unfreeze_wallet ──────────────────────────────────────────────────────

async function toolUnfreezeWallet({ wallet, reason, resolutionReference }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return mcpError('INVALID_WALLET', 'wallet must be a valid 0x address');
  }
  if (!reason || reason.trim() === '') {
    return mcpError('INVALID_REASON', 'reason is required');
  }

  // Pre-checks
  const isFrozen = await policyIsFrozen(wallet);
  if (!isFrozen) {
    return mcpError('WALLET_NOT_FROZEN', 'Wallet is not frozen');
  }

  const isSanctioned = await policyIsSanctioned(wallet);
  if (isSanctioned) {
    return mcpError('SANCTIONS_BLOCK', 'Wallet is on sanctions list — only ADMIN_ROLE multisig can remove sanctions');
  }

  const auditId = nextAuditId();
  auditLog('unfreeze_wallet_pre_tx', { wallet, reason, resolutionReference, auditId }, null);

  const txHash = await chainUnfreezeWallet(wallet);

  const result = {
    success: true,
    wallet,
    reason,
    txHash,
    unfrozenAt: nowIso(),
    auditLogId: auditId,
  };

  auditLog('unfreeze_wallet_result', { wallet, reason }, result);
  return mcpOk(result);
}

// ── 14. add_to_sanctions ─────────────────────────────────────────────────────

async function toolAddToSanctions({ wallet, reason, authority, referenceDocument }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return mcpError('INVALID_WALLET', 'wallet must be a valid 0x address');
  }
  if (!reason || reason.trim() === '') {
    return mcpError('INVALID_REASON', 'reason is required');
  }

  const validAuthorities = ['OFAC', 'UIF_BOLIVIA', 'INTERNAL'];
  if (!validAuthorities.includes(authority)) {
    return mcpError('INVALID_AUTHORITY', `authority must be one of: ${validAuthorities.join(', ')}`);
  }

  // Pre-check
  const isSanctioned = await policyIsSanctioned(wallet);
  if (isSanctioned) {
    return mcpError('WALLET_ALREADY_SANCTIONED', 'Wallet is already on sanctions list');
  }

  // Log ALL fields before sending tx — this is an irreversible action
  const auditId = nextAuditId();
  auditLog('add_to_sanctions_pre_tx', {
    wallet,
    reason,
    authority,
    referenceDocument,
    auditId,
    warning: 'IRREVERSIBLE — only ADMIN_ROLE multisig can remove',
  }, null);

  const txHash = await chainAddToSanctions(wallet);

  const result = {
    success: true,
    wallet,
    authority,
    txHash,
    sanctionedAt: nowIso(),
    auditLogId: auditId,
    removalRequires: 'ADMIN_ROLE (multisig 3/5)',
  };

  auditLog('add_to_sanctions_result', { wallet, authority }, result);
  return mcpOk(result);
}

// ── 15. emergency_mint ────────────────────────────────────────────────────────

async function toolEmergencyMint({ wallet, amount_bs, orderId }) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return mcpError('INVALID_WALLET', 'wallet must be a valid 0x address');
  }
  if (!amount_bs || amount_bs <= 0) {
    return mcpError('INVALID_AMOUNT', 'amount_bs must be > 0');
  }
  if (!orderId) {
    return mcpError('INVALID_ORDER', 'orderId is required');
  }

  // Verify KYC before minting
  const isValid = await ccidIsValid(wallet);
  if (!isValid) {
    return mcpError('KYC_REQUIRED', 'Wallet does not have a valid KYC identity. Call register_identity first.');
  }

  // Verify order is confirmed (deposit received)
  const order = getOrderById(orderId);
  if (!order) return mcpError('ORDER_NOT_FOUND', `Order ${orderId} not found`);
  if (order.status !== 'confirmed') {
    return mcpError('ORDER_NOT_CONFIRMED', `Order ${orderId} is ${order.status}, must be confirmed first`);
  }

  auditLog('emergency_mint_pre_tx', { wallet, amount_bs, orderId }, null);

  const txHash = await chainMintTokens(wallet, amount_bs);

  // Mark order as minted
  updateOrderStatus(orderId, 'minted');

  const result = {
    success: true,
    wallet,
    amount_bs,
    orderId,
    txHash,
    mintedAt: nowIso(),
    note: 'Emergency mint — replace with CRE when available',
  };

  auditLog('emergency_mint_result', { wallet, amount_bs, orderId }, result);
  return mcpOk(result);
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────

function createMcpServer() {
  const server = new Server(
    { name: 'bobc-bank-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    return handleTool(name, args || {});
  });

  return server;
}

// ─── Start SSE HTTP server ────────────────────────────────────────────────────

export function startMcpServer() {
  const mcpServer = createMcpServer();

  // Map of SSE transports keyed by session ID
  const transports = new Map();

  const httpServer = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // SSE endpoint — client connects here to receive messages
    if (method === 'GET' && url === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => {
        transports.delete(transport.sessionId);
      });
      await mcpServer.connect(transport);
      return;
    }

    // Message endpoint — client POSTs tool calls here
    if (method === 'POST' && url.startsWith('/message')) {
      const urlObj = new URL(url, `http://localhost:${MCP_PORT}`);
      const sessionId = urlObj.searchParams.get('sessionId');
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Session not found' }));
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    // Health check
    if (method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', server: 'bobc-mcp', tools: TOOLS.length }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(MCP_PORT, () => {
    console.log(`[mcp-server] SSE transport listening on http://localhost:${MCP_PORT}/sse`);
    console.log(`[mcp-server] ${TOOLS.length} tools registered`);
  });

  return httpServer;
}

// ─── Stdio transport (for direct MCP client connections) ─────────────────────

export async function startMcpStdio() {
  const mcpServer = createMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[mcp-server] stdio transport active');
}
