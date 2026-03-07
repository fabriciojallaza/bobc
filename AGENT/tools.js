/**
 * tools.js — Tool definitions and HTTP executors for the BOBC agent
 *
 * Tools call the backend HTTP API directly (no MCP SSE needed).
 * The agent can call any tool autonomously in its loop.
 */

import fetch from 'node-fetch';

const BACKEND_URL = process.env.BACKEND_URL || 'https://bobc.condordev.xyz';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${BACKEND_URL}${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function callMcpTool(name, args) {
  // Call MCP tools via HTTP message endpoint
  const res = await fetch(`${BACKEND_URL}/mcp/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const data = await res.json();
  return data.result?.content?.[0]?.text || JSON.stringify(data);
}

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeTool(name, args) {
  switch (name) {

    case 'get_pending_work': {
      const data = await get('/admin/pending');
      return JSON.stringify(data);
    }

    case 'get_order': {
      const data = await get(`/admin/orders`);
      const order = data.orders?.find(o => o.id === args.order_id);
      return JSON.stringify(order || { error: 'not found' });
    }

    case 'approve_kyc': {
      const result = await post('/admin/kyc/approve', {
        wallet: args.wallet,
        tier: args.tier || 'KYC1',
        ci: args.ci,
      });
      return JSON.stringify(result);
    }

    case 'reject_kyc': {
      // Mark as rejected in SQLite via backend
      const result = await post('/admin/kyc/reject', {
        wallet: args.wallet,
        reason: args.reason,
      });
      return JSON.stringify(result);
    }

    case 'validate_receipt': {
      // This tool is handled specially in index.js (needs imageBase64 from the order)
      // Here just return the order data for context
      const data = await get('/admin/orders');
      const order = data.orders?.find(o => o.id === args.order_id);
      return JSON.stringify({ order, note: 'Use validate_receipt_image for vision validation' });
    }

    case 'confirm_deposit': {
      const result = await post('/admin/deposit', {
        orderId: args.order_id,
        amount_bs: args.amount_bs,
      });
      return JSON.stringify(result);
    }

    case 'emergency_mint': {
      const result = await post('/admin/emergency-mint', {
        wallet: args.wallet,
        amount_bs: args.amount_bs,
        orderId: args.order_id,
      });
      return JSON.stringify(result);
    }

    case 'get_bank_balance': {
      const data = await get('/batch');
      return JSON.stringify({ bankBalance: data.bankBalance, approvedIds: data.approvedIds });
    }

    case 'freeze_wallet': {
      const result = await post('/admin/freeze-wallet', { wallet: args.wallet });
      return JSON.stringify(result);
    }

    case 'add_to_sanctions': {
      const result = await post('/admin/add-sanctions', { wallet: args.wallet });
      return JSON.stringify(result);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Tool definitions (OpenAI format for LLM) ────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_pending_work',
      description: 'Get all pending work: KYC requests to review, orders awaiting deposit confirmation, and orders confirmed ready to mint.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_order',
      description: 'Get details of a specific order by ID.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: 'The order ID' },
        },
        required: ['order_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_kyc',
      description: 'Approve a KYC request and register the identity on-chain. Use after verifying name and CI are valid.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Wallet address to approve' },
          tier: { type: 'string', enum: ['KYC1', 'KYC2', 'KYC3'], description: 'KYC tier. Use KYC1 for standard users.' },
          ci: { type: 'string', description: 'CI number for credential hash' },
        },
        required: ['wallet', 'ci'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reject_kyc',
      description: 'Reject a KYC request with a reason.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string' },
          reason: { type: 'string', description: 'Reason for rejection' },
        },
        required: ['wallet', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_deposit',
      description: 'Confirm a bank deposit was received. Updates bank balance and marks order as confirmed.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'number' },
          amount_bs: { type: 'number', description: 'Amount in BOB' },
        },
        required: ['order_id', 'amount_bs'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emergency_mint',
      description: 'Mint BOBC tokens to a wallet after deposit is confirmed. Only use after confirm_deposit.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string' },
          amount_bs: { type: 'number' },
          order_id: { type: 'number' },
        },
        required: ['wallet', 'amount_bs', 'order_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bank_balance',
      description: 'Get current bank balance and list of approved order IDs.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'freeze_wallet',
      description: 'Freeze a wallet to block all operations. Use for suspicious activity.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string' },
          reason: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['wallet', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_sanctions',
      description: 'Add a wallet to the sanctions list. IRREVERSIBLE by agent.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string' },
          reason: { type: 'string' },
          authority: { type: 'string', enum: ['OFAC', 'UIF_BOLIVIA', 'INTERNAL'] },
        },
        required: ['wallet', 'reason', 'authority'],
      },
    },
  },
];
