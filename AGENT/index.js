/**
 * BOBC Agent — Loop principal
 *
 * Cada LOOP_INTERVAL_MS:
 *   1. Pre-check: GET /admin/pending (sin LLM)
 *   2. Si no hay trabajo → skip (no gasta tokens)
 *   3. Si hay trabajo:
 *      a. KYC pendientes → LLM revisa y aprueba/rechaza
 *      b. Órdenes awaiting_validation con receipt → Gemini vision valida comprobante
 *      c. Órdenes confirmed → LLM ejecuta emergency_mint
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import { callWithTools, callForJson } from './llm.js';
import { executeTool, TOOL_DEFINITIONS } from './tools.js';

const BACKEND_URL = process.env.BACKEND_URL || 'https://bobc.condordev.xyz';
const LOOP_INTERVAL_MS = parseInt(process.env.LOOP_INTERVAL_MS || '30000');

async function logActivity(type, message) {
  try {
    await fetch(`${BACKEND_URL}/agent/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message }),
    });
  } catch {}
}

const SYSTEM_PROMPT = `Eres el operador del sistema BOBC Stablecoin para Bolivia.
Tu trabajo es procesar trabajo pendiente: revisar KYCs y confirmar depósitos.

REGLAS PARA KYC:
- Aprobar si: nombre completo (al menos 2 palabras) + CI válido (7+ dígitos)
- Rechazar si: datos incompletos, CI muy corto, o nombre obviamente falso
- Tier por defecto: KYC1

REGLAS PARA DEPÓSITOS:
- Solo mintea DESPUÉS de confirm_deposit
- El monto del mint debe coincidir exactamente con el monto de la orden
- Si la orden ya está en status 'confirmed', procede directamente al mint

FLUJO CORRECTO para una orden confirmed:
1. emergency_mint(wallet, amount_bs, order_id)

FLUJO CORRECTO para una orden awaiting_validation:
1. El sistema ya validó el comprobante — si está aquí con receipt_validated=1, confirm_deposit + emergency_mint
2. Si receipt_validated=0, esperar — la validación visual se hace por separado

Sé eficiente: procesa todo el trabajo pendiente en cada llamada.
Responde en español con un resumen de lo que hiciste.`;

// ─── Pre-check sin LLM ────────────────────────────────────────────────────────

async function getPendingWork() {
  const res = await fetch(`${BACKEND_URL}/admin/pending`);
  return res.json();
}

// ─── Validación de comprobante con Gemini vision ──────────────────────────────

async function validateReceiptWithVision(order) {
  if (!order.receipt_image) return null;

  console.log(`[agent] validating receipt for order ${order.id} (Bs ${order.amount_bs}, ref: ${order.reference})`);

  const result = await callForJson(
    `Eres un validador de comprobantes bancarios bolivianos.
     Analiza la imagen y extrae el monto transferido y el código de referencia.
     Responde SOLO con JSON válido.`,
    `Analiza este comprobante bancario. La orden tiene:
     - Monto esperado: Bs ${order.amount_bs}
     - Referencia esperada: ${order.reference}

     Extrae del comprobante:
     1. El monto transferido (número)
     2. El código de referencia o descripción
     3. Si parece un comprobante bancario real

     Responde con este JSON exacto:
     {
       "monto_encontrado": <número o null>,
       "referencia_encontrada": "<string o null>",
       "parece_comprobante_real": <true/false>,
       "monto_coincide": <true/false>,
       "referencia_coincide": <true/false>,
       "aprobado": <true/false>,
       "razon": "<explicación breve>",
       "transaction_id": "<ID o número de transacción bancaria que aparece en el comprobante, string o null>"
     }`,
    order.receipt_image
  );

  console.log(`[agent] receipt validation result:`, JSON.stringify(result));
  return result;
}

// ─── Procesar órdenes awaiting_validation ─────────────────────────────────────

async function processAwaitingValidation(orders) {
  for (const order of orders) {
    console.log(`[agent] processing awaiting_validation order ${order.id}`);

    if (!order.receipt_image) {
      console.log(`[agent] order ${order.id} has no receipt yet, skipping`);
      continue;
    }

    if (order.receipt_validated) {
      // Ya validado visualmente, proceder al mint
      console.log(`[agent] order ${order.id} already validated, proceeding to mint`);
      await executeTool('confirm_deposit', { order_id: order.id, amount_bs: order.amount_bs });
      await executeTool('emergency_mint', { wallet: order.wallet, amount_bs: order.amount_bs, order_id: order.id });
      continue;
    }

    // Validar con Gemini vision
    const validation = await validateReceiptWithVision(order);
    if (!validation) continue;

    if (validation.aprobado) {
      console.log(`[agent] receipt approved for order ${order.id}: ${validation.razon}`);

      // Verificar duplicado por transaction_id
      if (validation.transaction_id) {
        try {
          const checkRes = await fetch(`${BACKEND_URL}/admin/receipt/check-txid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txId: validation.transaction_id, orderId: order.id }),
          }).then(r => r.json());

          if (checkRes.duplicate === true) {
            await logActivity('fraud_attempt', `⚠️ Comprobante duplicado detectado — tx_id ${validation.transaction_id} ya usado en orden #${checkRes.existingOrderId}`);
            console.log(`[agent] FRAUD: duplicate tx_id ${validation.transaction_id} for order ${order.id}`);
            continue;
          }
        } catch (e) {
          console.error(`[agent] check-txid failed for order ${order.id}:`, e.message);
        }
      }

      await logActivity('receipt_approved', `🔍 Comprobante verificado — Bs ${order.amount_bs} confirmados`);

      // Marcar como validado en backend
      await fetch(`${BACKEND_URL}/admin/receipt/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });

      // Confirmar depósito y mintear
      await executeTool('confirm_deposit', { order_id: order.id, amount_bs: order.amount_bs });
      await executeTool('emergency_mint', { wallet: order.wallet, amount_bs: order.amount_bs, order_id: order.id });

      // Guardar transaction_id después de confirm exitoso
      if (validation.transaction_id) {
        try {
          await fetch(`${BACKEND_URL}/admin/receipt/save-txid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id, txId: validation.transaction_id }),
          });
        } catch (e) {
          console.error(`[agent] save-txid failed for order ${order.id}:`, e.message);
        }
      }

      await logActivity('minted', `🪙 ${order.amount_bs} BOBC emitidos on-chain`);
    } else {
      console.log(`[agent] receipt REJECTED for order ${order.id}: ${validation.razon}`);
      await logActivity('receipt_rejected', `❌ Comprobante rechazado — ${validation.razon}`);
    }
  }
}

// ─── Loop principal ───────────────────────────────────────────────────────────

async function runLoop() {
  console.log('[agent] checking pending work...');

  let pending;
  try {
    pending = await getPendingWork();
  } catch (e) {
    console.error('[agent] failed to reach backend:', e.message);
    return;
  }

  const { summary, pendingKyc, confirmedOrders } = pending;

  // Obtener órdenes awaiting_validation
  let awaitingValidation = [];
  try {
    const allOrders = await fetch(`${BACKEND_URL}/admin/orders`).then(r => r.json());
    awaitingValidation = (allOrders.orders || []).filter(o => o.status === 'awaiting_validation');
  } catch (e) {}

  const hasWork = summary.kycToReview > 0 || summary.readyToMint > 0 || awaitingValidation.length > 0;

  if (!hasWork) {
    console.log(`[agent] nothing to do (kyc=${summary.kycToReview}, mint=${summary.readyToMint}, validating=${awaitingValidation.length})`);
    return;
  }

  console.log(`[agent] work found — kyc=${summary.kycToReview}, confirmed=${summary.readyToMint}, awaiting=${awaitingValidation.length}`);

  // 1. Procesar comprobantes con vision (sin LLM de chat)
  if (awaitingValidation.length > 0) {
    await processAwaitingValidation(awaitingValidation);
  }

  // 2. Si hay KYC pendientes o mints confirmados → llamar al LLM
  if (summary.kycToReview > 0) {
    await logActivity('kyc_reviewing', `🔎 Revisando ${summary.kycToReview} solicitud(es) KYC pendiente(s)`);
  }

  if (summary.kycToReview > 0 || summary.readyToMint > 0) {
    const contextParts = [];

    if (pendingKyc.length > 0) {
      contextParts.push(`KYC pendientes de revisión:\n${JSON.stringify(pendingKyc.map(k => ({
        wallet: k.wallet,
        nombre: k.nombre,
        ci: k.ci,
        telefono: k.telefono,
      })), null, 2)}`);
    }

    if (confirmedOrders.length > 0) {
      contextParts.push(`Órdenes confirmadas listas para mint:\n${JSON.stringify(confirmedOrders.map(o => ({
        id: o.id,
        wallet: o.wallet,
        amount_bs: o.amount_bs,
        reference: o.reference,
      })), null, 2)}`);
    }

    const userMessage = `Hay trabajo pendiente. Procesa todo:\n\n${contextParts.join('\n\n')}`;

    console.log('[agent] calling LLM with context...');
    try {
      const response = await callWithTools(SYSTEM_PROMPT, userMessage, TOOL_DEFINITIONS, executeTool);
      console.log(`[agent] LLM response: ${response}`);
    } catch (e) {
      console.error('[agent] LLM error:', e.message);
    }
  }
}

// ─── Arranque ─────────────────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════╗
║         BOBC Agent — Running             ║
╠══════════════════════════════════════════╣
║  Backend: ${BACKEND_URL}
║  Interval: ${LOOP_INTERVAL_MS / 1000}s
╚══════════════════════════════════════════╝
`);

// Primera ejecución inmediata
runLoop().catch(console.error);

// Loop periódico
setInterval(() => {
  runLoop().catch(console.error);
}, LOOP_INTERVAL_MS);
