/**
 * http-server.js — HTTP API for BOBC backend
 * Port: process.env.HTTP_PORT || 3001
 *
 * Frontend endpoints:
 *   GET  /health
 *   POST /kyc
 *   GET  /kyc/:wallet
 *   POST /orders
 *   GET  /orders/:wallet
 *
 * CRE endpoint:
 *   GET  /batch
 *
 * Admin/demo endpoints:
 *   POST /admin/deposit
 *   GET  /admin/orders
 *   GET  /admin/kyc
 *   POST /admin/reset
 */

import http from 'http';
import { createHash } from 'crypto';
import {
  getBankBalance,
  createKycRequest,
  getKycByWallet,
  getAllKyc,
  createOrder,
  getOrdersByWallet,
  getAllOrders,
  getOrderById,
  confirmOrder,
  getConfirmedOrderIds,
  resetAllOrders,
  saveReceipt,
  auditLog,
  updateKycStatus,
  markReceiptValidated,
  updateOrderStatus,
  logAgentActivity,
  getRecentAgentActivity,
  checkReceiptHash,
  checkBankTxId,
  saveBankTxId,
} from './db.js';
import { mintTokens, getTotalSupply, getWalletProfile, registerIdentity, computeCredentialHash, freezeWallet, addToSanctions } from './chain.js';

const HTTP_PORT = Number(process.env.HTTP_PORT) || 3001;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function parseBody(req, res) {
  try {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : {};
  } catch {
    json(res, 400, { error: 'Invalid JSON body' });
    return null;
  }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

function handleHealth(res) {
  const bankBalance = getBankBalance();
  json(res, 200, { status: 'ok', bankBalance });
}

let _transparencyCache = null;
let _transparencyCacheTs = 0;
const TRANSPARENCY_TTL = 30_000;

async function handleWalletProfile(res, wallet) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return json(res, 400, { error: 'Invalid wallet address' });
  }
  const profile = await getWalletProfile(wallet);
  json(res, 200, profile);
}

function handleAgentActivity(res) {
  const activity = getRecentAgentActivity(20);
  json(res, 200, { activity });
}

async function handleAgentLog(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;
  const { type, message } = body;
  if (!type || !message) return json(res, 400, { error: 'type and message required' });
  logAgentActivity(type, message);
  json(res, 200, { ok: true });
}

async function handleAdminKycApprove(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;
  const { wallet, tier, ci } = body;
  if (!wallet || !tier) return json(res, 400, { error: 'wallet and tier required' });
  try {
    const credentialHash = computeCredentialHash(wallet, ci || wallet);
    const txHash = await registerIdentity(wallet, tier, credentialHash);
    updateKycStatus(wallet, 'approved', 1, null, txHash);
    json(res, 200, { ok: true, txHash });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

async function handleAdminFreezeWallet(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;
  const { wallet } = body;
  if (!wallet) return json(res, 400, { error: 'wallet required' });
  try {
    const txHash = await freezeWallet(wallet);
    json(res, 200, { ok: true, txHash });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

async function handleAdminAddSanctions(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;
  const { wallet } = body;
  if (!wallet) return json(res, 400, { error: 'wallet required' });
  try {
    const txHash = await addToSanctions(wallet);
    json(res, 200, { ok: true, txHash });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

async function handleTransparency(res) {
  const now = Date.now();
  if (_transparencyCache && now - _transparencyCacheTs < TRANSPARENCY_TTL) {
    return json(res, 200, _transparencyCache);
  }
  const bankBalance = getBankBalance();
  const totalSupply = await getTotalSupply().catch(() => 0);
  const ratio = totalSupply > 0 ? Math.round((bankBalance / totalSupply) * 100) : 100;
  _transparencyCache = { bankBalance, totalSupply, ratio };
  _transparencyCacheTs = now;
  json(res, 200, _transparencyCache);
}

async function handlePostKyc(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;

  const { wallet, nombre, ci, telefono } = body;

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return json(res, 400, { error: 'wallet must be a valid 0x address' });
  }
  if (!nombre || typeof nombre !== 'string' || nombre.trim() === '') {
    return json(res, 400, { error: 'nombre is required' });
  }
  if (!ci || typeof ci !== 'string' || ci.trim() === '') {
    return json(res, 400, { error: 'ci is required' });
  }

  try {
    const result = createKycRequest({ wallet, nombre, ci, telefono });
    auditLog('kyc_request_created', { wallet, nombre }, { id: result.lastInsertRowid });
    json(res, 201, {
      ok: true,
      id: result.lastInsertRowid,
      wallet: wallet.toLowerCase(),
      status: 'pending',
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return json(res, 409, { error: 'KYC request already exists for this wallet' });
    }
    throw err;
  }
}

function handleGetKyc(res, wallet) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return json(res, 400, { error: 'Invalid wallet address' });
  }
  const kyc = getKycByWallet(wallet);
  if (!kyc) return json(res, 404, { error: 'KYC request not found' });
  json(res, 200, kyc);
}

async function handlePostOrders(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;

  const { wallet, amount_bs } = body;

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return json(res, 400, { error: 'wallet must be a valid 0x address' });
  }
  if (typeof amount_bs !== 'number' || amount_bs <= 0 || !Number.isFinite(amount_bs)) {
    return json(res, 400, { error: 'amount_bs must be a positive number' });
  }

  const { id, reference } = createOrder({ wallet, amount_bs });
  auditLog('order_created', { wallet, amount_bs }, { id, reference });
  json(res, 201, { ok: true, id, reference, status: 'pending' });
}

function handleGetOrders(res, wallet) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return json(res, 400, { error: 'Invalid wallet address' });
  }
  const orders = getOrdersByWallet(wallet);
  json(res, 200, { wallet: wallet.toLowerCase(), orders });
}

async function handlePostReceipt(req, res, orderId) {
  const order = getOrderById(orderId);
  if (!order) return json(res, 404, { error: 'Order not found' });
  if (!['pending', 'awaiting_validation'].includes(order.status)) {
    return json(res, 400, { error: `Order is already ${order.status}` });
  }

  const body = await readBody(req);
  const { image_base64 } = JSON.parse(body);

  if (!image_base64) return json(res, 400, { error: 'image_base64 required' });

  const hash = createHash('sha256').update(image_base64).digest('hex');
  const duplicate = checkReceiptHash(hash);
  if (duplicate) {
    return json(res, 409, { error: 'Comprobante ya utilizado', code: 'DUPLICATE_RECEIPT' });
  }

  saveReceipt(orderId, image_base64, hash);
  auditLog('receipt_uploaded', { orderId }, { status: 'awaiting_validation' });

  json(res, 200, {
    ok: true,
    orderId,
    status: 'awaiting_validation',
    message: 'Receipt received. Agent will validate and process mint shortly.',
  });
}

function handleGetBatch(res) {
  const bankBalance = getBankBalance();
  const approvedIds = getConfirmedOrderIds();
  json(res, 200, { bankBalance, approvedIds });
}

// ─── Admin handlers ───────────────────────────────────────────────────────────

async function handleAdminDeposit(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;

  const { orderId, amount_bs } = body;

  if (typeof orderId !== 'number' || !Number.isInteger(orderId) || orderId < 1) {
    return json(res, 400, { error: 'orderId must be a positive integer' });
  }
  if (typeof amount_bs !== 'number' || amount_bs <= 0 || !Number.isFinite(amount_bs)) {
    return json(res, 400, { error: 'amount_bs must be a positive number' });
  }

  const order = getOrderById(orderId);
  if (!order) return json(res, 404, { error: 'Order not found' });
  if (order.status === 'confirmed') {
    return json(res, 409, { error: 'Order already confirmed' });
  }

  confirmOrder(orderId, amount_bs);
  const newBalance = getBankBalance();
  auditLog('admin_deposit', { orderId, amount_bs }, { newBalance });
  json(res, 200, { ok: true, orderId, amount_bs, newBankBalance: newBalance });
}

function handleAdminOrders(res) {
  json(res, 200, { orders: getAllOrders() });
}

function handleAdminKyc(res) {
  json(res, 200, { kyc: getAllKyc() });
}

async function handleAdminKycReject(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;
  const { wallet, reason } = body;
  updateKycStatus(wallet, 'rejected', null, reason);
  json(res, 200, { ok: true });
}

async function handleAdminReceiptValidate(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;
  const { orderId } = body;
  markReceiptValidated(orderId);
  json(res, 200, { ok: true });
}

async function handleAdminReset(res) {
  resetAllOrders();
  auditLog('admin_reset', null, { ok: true });
  json(res, 200, { ok: true, message: 'Balance reset to 0, all orders set to pending' });
}

async function handleAdminEmergencyMint(req, res) {
  const body = await parseBody(req, res);
  if (!body) return;
  const { wallet, amount_bs, orderId } = body;
  if (!wallet || !amount_bs) return json(res, 400, { error: 'wallet and amount_bs required' });
  try {
    const txHash = await mintTokens(wallet, amount_bs);
    if (orderId) updateOrderStatus(orderId, 'minted');
    auditLog('emergency_mint', { wallet, amount_bs, orderId }, { txHash });
    json(res, 200, { ok: true, txHash });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

// ─── OPTIONS preflight ────────────────────────────────────────────────────────

function handleOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createHttpServer() {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') return handleOptions(res);

    try {
      // Health
      if (method === 'GET' && url === '/transparency') {
        return handleTransparency(res);
      }

      if (method === 'GET' && url === '/health') {
        return handleHealth(res);
      }

      // Wallet profile (multicall)
      const profileMatch = url.match(/^\/profile\/(0x[a-fA-F0-9]{40})$/i);
      if (method === 'GET' && profileMatch) {
        return await handleWalletProfile(res, profileMatch[1]);
      }

      // KYC
      if (method === 'POST' && url === '/kyc') {
        return await handlePostKyc(req, res);
      }
      const kycMatch = url.match(/^\/kyc\/(0x[a-fA-F0-9]{40})$/i);
      if (method === 'GET' && kycMatch) {
        return handleGetKyc(res, kycMatch[1]);
      }

      // Orders
      if (method === 'POST' && url === '/orders') {
        return await handlePostOrders(req, res);
      }
      const ordersMatch = url.match(/^\/orders\/(0x[a-fA-F0-9]{40})$/i);
      if (method === 'GET' && ordersMatch) {
        return handleGetOrders(res, ordersMatch[1]);
      }

      // Receipt upload: POST /orders/:id/receipt
      const receiptMatch = url.match(/^\/orders\/(\d+)\/receipt$/);
      if (method === 'POST' && receiptMatch) {
        return await handlePostReceipt(req, res, parseInt(receiptMatch[1]));
      }

      // CRE batch
      if (method === 'GET' && url === '/batch') {
        return handleGetBatch(res);
      }

      // Admin
      if (method === 'POST' && url === '/admin/deposit') {
        return await handleAdminDeposit(req, res);
      }
      if (method === 'GET' && url === '/admin/orders') {
        return handleAdminOrders(res);
      }
      if (method === 'GET' && url === '/admin/kyc') {
        return handleAdminKyc(res);
      }
      // Agent inbox: what needs attention right now
      if (method === 'GET' && url === '/admin/pending') {
        const pendingKyc = getAllKyc().filter(k => k.status === 'pending');
        const allOrders = getAllOrders();
        const pendingOrders = allOrders.filter(o => o.status === 'pending');
        const confirmedOrders = allOrders.filter(o => o.status === 'confirmed');
        return json(res, 200, {
          pendingKyc,
          pendingOrders,
          confirmedOrders,
          summary: {
            kycToReview: pendingKyc.length,
            depositsToConfirm: pendingOrders.length,
            readyToMint: confirmedOrders.length,
          },
        });
      }
      if (method === 'POST' && url === '/admin/kyc/reject') {
        return await handleAdminKycReject(req, res);
      }
      if (method === 'POST' && url === '/admin/receipt/validate') {
        return await handleAdminReceiptValidate(req, res);
      }
      if (method === 'POST' && url === '/admin/receipt/check-txid') {
        const b = await parseBody(req, res);
        if (!b) return;
        const { txId } = b;
        if (!txId) return json(res, 400, { error: 'txId required' });
        const result = checkBankTxId(txId);
        return json(res, 200, { duplicate: !!result, existingOrderId: result?.id || null });
      }
      if (method === 'POST' && url === '/admin/receipt/save-txid') {
        const b = await parseBody(req, res);
        if (!b) return;
        const { orderId, txId } = b;
        if (!orderId || !txId) return json(res, 400, { error: 'orderId and txId required' });
        saveBankTxId(orderId, txId);
        return json(res, 200, { ok: true });
      }
      if (method === 'POST' && url === '/admin/reset') {
        return await handleAdminReset(res);
      }
      if (method === 'POST' && url === '/admin/emergency-mint') {
        return await handleAdminEmergencyMint(req, res);
      }

      if (method === 'POST' && url === '/admin/kyc/approve') {
        return await handleAdminKycApprove(req, res);
      }

      if (method === 'POST' && url === '/admin/freeze-wallet') {
        return await handleAdminFreezeWallet(req, res);
      }

      if (method === 'POST' && url === '/admin/add-sanctions') {
        return await handleAdminAddSanctions(req, res);
      }

      if (method === 'GET' && url === '/agent/activity') {
        return handleAgentActivity(res);
      }

      if (method === 'POST' && url === '/agent/log') {
        return await handleAgentLog(req, res);
      }

      json(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('[http-server] unhandled error:', err);
      json(res, 500, { error: 'Internal server error' });
    }
  });

  return server;
}

export function startHttpServer() {
  const server = createHttpServer();
  server.listen(HTTP_PORT, () => {
    console.log(`[http-server] listening on http://localhost:${HTTP_PORT}`);
  });
  return server;
}
