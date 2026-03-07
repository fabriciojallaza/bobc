/**
 * db.js — SQLite setup and query helpers for BOBC backend
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './bobc.db';

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kyc_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      ci TEXT NOT NULL,
      telefono TEXT,
      status TEXT DEFAULT 'pending',
      tier INTEGER DEFAULT 1,
      rejection_reason TEXT,
      tx_hash TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      amount_bs REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      reference TEXT UNIQUE,
      receipt_image TEXT,
      receipt_validated INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS bank (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance_bs REAL DEFAULT 0
    );

    INSERT OR IGNORE INTO bank (id, balance_bs) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      params TEXT,
      result TEXT,
      ts INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS wallet_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      user_id TEXT,
      link_id TEXT,
      linked_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(wallet),
      UNIQUE(bank_account_id)
    );

    CREATE TABLE IF NOT EXISTS processed_redeems (
      redeem_id TEXT PRIMARY KEY,
      transfer_id TEXT,
      processed_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS verified_ownership (
      user_id TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      verified_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, bank_account_id)
    );

    CREATE TABLE IF NOT EXISTS agent_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      ts INTEGER DEFAULT (unixepoch())
    );
  `);

  // Add receipt_hash and bank_tx_id columns if they don't exist
  try { db.exec('ALTER TABLE orders ADD COLUMN receipt_image TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN receipt_validated INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN receipt_hash TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN bank_tx_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE kyc_requests ADD COLUMN tx_hash TEXT'); } catch {}
}

// ─── Bank balance ────────────────────────────────────────────────────────────

export function getBankBalance() {
  const row = getDb().prepare('SELECT balance_bs FROM bank WHERE id = 1').get();
  return row ? row.balance_bs : 0;
}

export function addBankBalance(amount) {
  getDb().prepare('UPDATE bank SET balance_bs = balance_bs + ? WHERE id = 1').run(amount);
  return getBankBalance();
}

export function resetBankBalance() {
  getDb().prepare('UPDATE bank SET balance_bs = 0 WHERE id = 1').run();
}

// ─── KYC ─────────────────────────────────────────────────────────────────────

export function createKycRequest({ wallet, nombre, ci, telefono }) {
  const stmt = getDb().prepare(`
    INSERT INTO kyc_requests (wallet, nombre, ci, telefono)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(wallet.toLowerCase(), nombre, ci, telefono || null);
}

export function getKycByWallet(wallet) {
  return getDb()
    .prepare('SELECT * FROM kyc_requests WHERE wallet = ?')
    .get(wallet.toLowerCase());
}

export function getAllKyc() {
  return getDb().prepare('SELECT * FROM kyc_requests ORDER BY created_at DESC').all();
}

export function updateKycStatus(wallet, status, tier, rejection_reason, tx_hash) {
  getDb().prepare(`
    UPDATE kyc_requests
    SET status = ?, tier = ?, rejection_reason = ?, tx_hash = ?, updated_at = unixepoch()
    WHERE wallet = ?
  `).run(status, tier || 1, rejection_reason || null, tx_hash || null, wallet.toLowerCase());
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export function createOrder({ wallet, amount_bs }) {
  const reference = `TX-${Date.now()}`;
  const stmt = getDb().prepare(`
    INSERT INTO orders (wallet, amount_bs, reference)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(wallet.toLowerCase(), amount_bs, reference);
  return { id: result.lastInsertRowid, reference };
}

export function getOrdersByWallet(wallet) {
  return getDb()
    .prepare('SELECT * FROM orders WHERE wallet = ? ORDER BY created_at DESC')
    .all(wallet.toLowerCase());
}

export function getAllOrders() {
  return getDb().prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
}

export function getOrderById(id) {
  return getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

export function updateOrderStatus(id, status) {
  getDb().prepare(`
    UPDATE orders SET status = ?, updated_at = unixepoch() WHERE id = ?
  `).run(status, id);
}

export function confirmOrder(orderId, amount_bs) {
  const tx = getDb().transaction(() => {
    getDb().prepare(`
      UPDATE orders SET status = 'confirmed', updated_at = unixepoch() WHERE id = ?
    `).run(orderId);
    addBankBalance(amount_bs);
  });
  tx();
}

export function getConfirmedOrderIds() {
  const rows = getDb()
    .prepare("SELECT id FROM orders WHERE status = 'confirmed'")
    .all();
  return rows.map(r => r.id);
}

export function resetAllOrders() {
  getDb().prepare("UPDATE orders SET status = 'pending', updated_at = unixepoch()").run();
  resetBankBalance();
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export function auditLog(action, params, result) {
  getDb().prepare(`
    INSERT INTO audit_log (action, params, result) VALUES (?, ?, ?)
  `).run(
    action,
    params != null ? JSON.stringify(params) : null,
    result != null ? JSON.stringify(result) : null
  );
}

// ─── Wallet links ─────────────────────────────────────────────────────────────

export function createWalletLink({ wallet, bankAccountId, userId, linkId }) {
  getDb().prepare(`
    INSERT OR REPLACE INTO wallet_links (wallet, bank_account_id, user_id, link_id)
    VALUES (?, ?, ?, ?)
  `).run(wallet.toLowerCase(), bankAccountId, userId || null, linkId || null);
}

export function getWalletLink(wallet) {
  return getDb()
    .prepare('SELECT * FROM wallet_links WHERE wallet = ?')
    .get(wallet.toLowerCase());
}

export function getWalletLinkByAccount(bankAccountId) {
  return getDb()
    .prepare('SELECT * FROM wallet_links WHERE bank_account_id = ?')
    .get(bankAccountId);
}

// ─── Processed redeems ───────────────────────────────────────────────────────

export function isRedeemProcessed(redeemId) {
  return !!getDb()
    .prepare('SELECT 1 FROM processed_redeems WHERE redeem_id = ?')
    .get(redeemId);
}

export function markRedeemProcessed(redeemId, transferId) {
  getDb().prepare(`
    INSERT OR IGNORE INTO processed_redeems (redeem_id, transfer_id) VALUES (?, ?)
  `).run(redeemId, transferId || null);
}

// ─── Ownership verification cache ────────────────────────────────────────────

export function markOwnershipVerified(userId, bankAccountId) {
  getDb().prepare(`
    INSERT OR REPLACE INTO verified_ownership (user_id, bank_account_id) VALUES (?, ?)
  `).run(userId, bankAccountId);
}

export function isOwnershipVerified(userId, bankAccountId) {
  return !!getDb()
    .prepare('SELECT 1 FROM verified_ownership WHERE user_id = ? AND bank_account_id = ?')
    .get(userId, bankAccountId);
}

// ─── Receipt handling ─────────────────────────────────────────────────────────

export function saveReceipt(orderId, imageBase64, receiptHash) {
  getDb().prepare(`
    UPDATE orders SET receipt_image = ?, receipt_hash = ?, status = 'awaiting_validation', updated_at = unixepoch()
    WHERE id = ?
  `).run(imageBase64, receiptHash || null, orderId);
}

export function checkReceiptHash(hash) {
  return getDb().prepare('SELECT id FROM orders WHERE receipt_hash = ?').get(hash);
}

export function checkBankTxId(txId) {
  return getDb().prepare("SELECT id FROM orders WHERE bank_tx_id = ? AND status NOT IN ('pending','cancelled')").get(txId);
}

export function saveBankTxId(orderId, txId) {
  return getDb().prepare('UPDATE orders SET bank_tx_id = ? WHERE id = ?').run(txId, orderId);
}

export function getOrdersAwaitingValidation() {
  return getDb().prepare(`
    SELECT * FROM orders WHERE status = 'awaiting_validation' ORDER BY created_at ASC
  `).all();
}

export function markReceiptValidated(orderId) {
  getDb().prepare(`
    UPDATE orders SET receipt_validated = 1, updated_at = unixepoch() WHERE id = ?
  `).run(orderId);
}

export function logAgentActivity(type, message) {
  getDb().prepare(`
    INSERT INTO agent_activity (type, message) VALUES (?, ?)
  `).run(type, message);
  // keep only last 50 entries
  getDb().prepare(`
    DELETE FROM agent_activity WHERE id NOT IN (
      SELECT id FROM agent_activity ORDER BY id DESC LIMIT 50
    )
  `).run();
}

export function getRecentAgentActivity(limit = 20) {
  return getDb().prepare(`
    SELECT type, message, ts FROM agent_activity ORDER BY id DESC LIMIT ?
  `).all(limit);
}
