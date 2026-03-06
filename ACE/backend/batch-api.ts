/**
 * batch-api.ts — Mock HTTP server for the Chainlink CRE PoR /batch endpoint
 *
 * PURPOSE (DEV/MOCK):
 *   Simulates the bank-side data feed consumed by the CRE workflow (CRE_PoR_Bool/por/main.ts).
 *   All state is held in memory. Restarting the server resets everything.
 *
 * IN PRODUCTION:
 *   Replace this file with a real adapter that reads bankBalance from your core banking system
 *   and persists orders in a database. The HTTP API contract (/batch, /batch/order, etc.) must
 *   remain identical so the CRE workflow does not need changes.
 *
 * ENDPOINTS:
 *   GET  /health          → { status: "ok" }
 *   GET  /batch           → { bankBalance: number, approvedIds: number[] }
 *   POST /batch/order     → { orderId, recipient, amount }  — register a new pending order
 *   POST /batch/confirm   → { orderId }                     — approve order, add amount to bankBalance
 *
 * USAGE:
 *   npx ts-node backend/batch-api.ts
 *   # or compile first:
 *   tsc backend/batch-api.ts --outDir backend/dist && node backend/dist/batch-api.js
 *
 * PORT: 3000 (override with PORT env var)
 */

import * as http from "http";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

interface PendingOrder {
  orderId: number;
  recipient: string;
  amount: number; // raw units (18-decimal integer as number — use BigInt in production)
}

let bankBalance: number = 0;
const approvedIds: number[] = [];
const pendingOrders: Map<number, PendingOrder> = new Map();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleHealth(res: http.ServerResponse): void {
  json(res, 200, { status: "ok" });
}

function handleGetBatch(res: http.ServerResponse): void {
  // This is the response consumed by CRE_PoR_Bool/por/main.ts every 30 s.
  json(res, 200, { bankBalance, approvedIds: [...approvedIds] });
}

async function handlePostOrder(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: { orderId?: unknown; recipient?: unknown; amount?: unknown };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const { orderId, recipient, amount } = body;

  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId < 0) {
    json(res, 400, { error: "orderId must be a non-negative integer" });
    return;
  }
  if (typeof recipient !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    json(res, 400, { error: "recipient must be a valid 0x address" });
    return;
  }
  if (typeof amount !== "number" || amount <= 0 || !Number.isFinite(amount)) {
    json(res, 400, { error: "amount must be a positive number" });
    return;
  }
  if (pendingOrders.has(orderId)) {
    json(res, 409, { error: "orderId already exists" });
    return;
  }

  pendingOrders.set(orderId, { orderId, recipient, amount });
  console.log(`[order] created orderId=${orderId} recipient=${recipient} amount=${amount}`);
  json(res, 201, { ok: true, orderId });
}

async function handlePostConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: { orderId?: unknown };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const { orderId } = body;

  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId < 0) {
    json(res, 400, { error: "orderId must be a non-negative integer" });
    return;
  }

  const order = pendingOrders.get(orderId);
  if (!order) {
    json(res, 404, { error: "orderId not found in pending orders" });
    return;
  }

  // Move order to approved state: add to approvedIds and credit bankBalance
  pendingOrders.delete(orderId);
  approvedIds.push(orderId);
  bankBalance += order.amount;

  console.log(
    `[confirm] orderId=${orderId} approved — bankBalance now ${bankBalance}, approvedIds count=${approvedIds.length}`
  );
  json(res, 200, { ok: true, orderId, bankBalance });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  try {
    if (method === "GET" && url === "/health") {
      return handleHealth(res);
    }
    if (method === "GET" && url === "/batch") {
      return handleGetBatch(res);
    }
    if (method === "POST" && url === "/batch/order") {
      return await handlePostOrder(req, res);
    }
    if (method === "POST" && url === "/batch/confirm") {
      return await handlePostConfirm(req, res);
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[error]", err);
    json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`[batch-api] mock server listening on http://localhost:${PORT}`);
  console.log(`[batch-api] NOTE: This is a development mock. In production, replace with a real bank adapter.`);
});
