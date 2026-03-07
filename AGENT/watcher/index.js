import { createPublicClient, webSocket, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';
import Database from 'better-sqlite3';

const WSS_URL = process.env.WSS_URL || 'wss://ethereum-sepolia-rpc.publicnode.com';
const CRE_BOBC = '0x87ba13aF77c9c37aBa42232B4C625C066a433eeE';
const DB_PATH = process.env.DB_PATH || '/opt/bobc-backend/bobc.db';
const BACKEND_URL = process.env.BACKEND_URL || 'https://bobc.condordev.xyz';

const db = new Database(DB_PATH);

const client = createPublicClient({
  chain: sepolia,
  transport: webSocket(WSS_URL),
});

async function logActivity(type, message) {
  try {
    await fetch(`${BACKEND_URL}/agent/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message }),
    });
  } catch {}
}

console.log(`[watcher] Starting — watching CRE_BOBC at ${CRE_BOBC}`);
console.log(`[watcher] WSS: ${WSS_URL}`);

const unwatch = client.watchEvent({
  address: CRE_BOBC,
  event: parseAbiItem('event BatchMinted(uint256[] orderIds)'),
  onLogs: async (logs) => {
    for (const log of logs) {
      const orderIds = log.args.orderIds;
      console.log(`[watcher] BatchMinted event — orderIds: ${orderIds}`);

      for (const creOrderId of orderIds) {
        const id = Number(creOrderId);
        const order = db.prepare('SELECT * FROM orders WHERE cre_order_id = ?').get(id);
        if (!order) {
          console.log(`[watcher] No order found for cre_order_id=${id}`);
          continue;
        }
        db.prepare("UPDATE orders SET status = 'minted', updated_at = unixepoch() WHERE cre_order_id = ?").run(id);
        console.log(`[watcher] Order ${order.id} marked as minted (cre_order_id=${id})`);
        await logActivity('minted', `🪙 ${order.amount_bs} BOBC emitidos on-chain (orden #${order.id})`);
      }
    }
  },
  onError: (error) => {
    console.error('[watcher] Event error:', error.message);
  },
});

// Reconnect on process errors
process.on('uncaughtException', (e) => console.error('[watcher] uncaughtException:', e.message));
process.on('unhandledRejection', (e) => console.error('[watcher] unhandledRejection:', e));
