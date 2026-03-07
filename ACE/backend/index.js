/**
 * index.js — Entry point for BOBC backend
 *
 * Starts:
 *   - HTTP server on HTTP_PORT (default 3001) — frontend + CRE + admin
 *   - MCP server on MCP_PORT  (default 3002) — SSE transport for AI agent
 */

// Load .env if present (optional, not required)
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simple .env loader (no external dep needed)
function loadEnv() {
  const envPath = resolve(__dirname, '.env');
  try {
    const contents = readFileSync(envPath, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
    console.log('[index] loaded .env');
  } catch {
    // .env not present — continue with process.env as-is
  }
}

loadEnv();

import { startHttpServer } from './http-server.js';
import { startMcpServer } from './mcp-server.js';
import { getDb } from './db.js';

// Ensure DB is initialized at startup
getDb();

const HTTP_PORT = Number(process.env.HTTP_PORT) || 3001;
const MCP_PORT = Number(process.env.MCP_PORT) || 3002;

// Start both servers
startHttpServer();
startMcpServer();

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║        BOBC Stablecoin Backend — Running         ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`║  HTTP API  →  http://localhost:${HTTP_PORT}              ║`);
console.log(`║  MCP SSE   →  http://localhost:${MCP_PORT}/sse          ║`);
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Endpoints:                                      ║');
console.log(`║    GET  http://localhost:${HTTP_PORT}/health            ║`);
console.log(`║    GET  http://localhost:${HTTP_PORT}/batch             ║`);
console.log(`║    POST http://localhost:${HTTP_PORT}/kyc               ║`);
console.log(`║    POST http://localhost:${HTTP_PORT}/orders            ║`);
console.log(`║    POST http://localhost:${HTTP_PORT}/admin/deposit     ║`);
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[index] shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[index] shutting down...');
  process.exit(0);
});

// Catch unhandled rejections to prevent crash
process.on('unhandledRejection', (reason, promise) => {
  console.error('[index] unhandledRejection:', reason);
});

process.on('uncaughtException', err => {
  console.error('[index] uncaughtException:', err);
  // Do not exit — keep server running
});
