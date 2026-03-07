/**
 * chain.js — On-chain calls with viem for BOBC backend
 *
 * Contracts interacted with:
 *   CCIDRegistry  — registerIdentity, revokeIdentity, isValid, getTier, getIdentity
 *   PolicyManager — freezeWallet, unfreezeWallet, addToSanctions, frozenWallets, sanctionsList
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbiItem,
  encodePacked,
  keccak256,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CCID_REGISTRY_ADDRESS = process.env.CCID_REGISTRY_ADDRESS;
const POLICY_MANAGER_ADDRESS = process.env.POLICY_MANAGER_ADDRESS;
const BOBC_ADDRESS = process.env.BOBC_ADDRESS;

// Resolve chain from RPC_URL
function resolveChain() {
  if (RPC_URL.includes('ethereum-sepolia') || RPC_URL.includes('11155111') || RPC_URL.includes('rpc2.sepolia') || RPC_URL.includes('publicnode.com')) return sepolia;
  return baseSepolia;
}

// ─── Clients (lazy-initialized) ──────────────────────────────────────────────

let _publicClient = null;
let _walletClient = null;
let _account = null;

function getPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: resolveChain(),
      transport: http(RPC_URL),
    });
  }
  return _publicClient;
}

function getWalletClient() {
  if (!_walletClient) {
    if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY env var not set');
    _account = privateKeyToAccount(PRIVATE_KEY);
    _walletClient = createWalletClient({
      account: _account,
      chain: resolveChain(),
      transport: http(RPC_URL),
    });
  }
  return _walletClient;
}

function getAccount() {
  getWalletClient(); // ensures _account is set
  return _account;
}

// ─── ABIs ────────────────────────────────────────────────────────────────────

const CCID_ABI = [
  {
    name: 'registerIdentity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wallet', type: 'address' },
      { name: 'tier', type: 'uint8' },
      { name: 'credentialHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'revokeIdentity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [],
  },
  {
    name: 'isValid',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getTier',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'getIdentity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'wallet', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'credentialHash', type: 'bytes32' },
        ],
      },
    ],
  },
];

const POLICY_MANAGER_ABI = [
  {
    name: 'freezeWallet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [],
  },
  {
    name: 'unfreezeWallet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [],
  },
  {
    name: 'addToSanctions',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [],
  },
  {
    name: 'frozenWallets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'sanctionsList',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
];

// ─── Tier mapping ─────────────────────────────────────────────────────────────
// KYCTier enum: NONE=0, KYC1=1, KYC2=2, KYC3=3

export const TIER_MAP = {
  KYC1: 1,
  KYC2: 2,
  KYC3: 3,
};

export const TIER_NAME_MAP = {
  0: 'NONE',
  1: 'KYC1',
  2: 'KYC2',
  3: 'KYC3',
};

// ─── Credential hash helper ──────────────────────────────────────────────────

/**
 * Compute credentialHash = keccak256(abi.encodePacked(wallet, ci))
 * Used for registerIdentity when the caller wants the MCP to derive it.
 */
export function computeCredentialHash(wallet, ci) {
  return keccak256(encodePacked(['address', 'string'], [getAddress(wallet), ci]));
}

// ─── On-chain read helpers ───────────────────────────────────────────────────

export async function ccidIsValid(wallet) {
  if (!CCID_REGISTRY_ADDRESS) return false;
  try {
    return await getPublicClient().readContract({
      address: CCID_REGISTRY_ADDRESS,
      abi: CCID_ABI,
      functionName: 'isValid',
      args: [getAddress(wallet)],
    });
  } catch (err) {
    console.error('[chain] ccidIsValid error:', err.message);
    return false;
  }
}

export async function ccidGetTier(wallet) {
  if (!CCID_REGISTRY_ADDRESS) return 0;
  try {
    const tier = await getPublicClient().readContract({
      address: CCID_REGISTRY_ADDRESS,
      abi: CCID_ABI,
      functionName: 'getTier',
      args: [getAddress(wallet)],
    });
    return Number(tier);
  } catch (err) {
    console.error('[chain] ccidGetTier error:', err.message);
    return 0;
  }
}

export async function ccidGetIdentity(wallet) {
  if (!CCID_REGISTRY_ADDRESS) return null;
  try {
    return await getPublicClient().readContract({
      address: CCID_REGISTRY_ADDRESS,
      abi: CCID_ABI,
      functionName: 'getIdentity',
      args: [getAddress(wallet)],
    });
  } catch (err) {
    console.error('[chain] ccidGetIdentity error:', err.message);
    return null;
  }
}

export async function policyIsFrozen(wallet) {
  if (!POLICY_MANAGER_ADDRESS) return false;
  try {
    return await getPublicClient().readContract({
      address: POLICY_MANAGER_ADDRESS,
      abi: POLICY_MANAGER_ABI,
      functionName: 'frozenWallets',
      args: [getAddress(wallet)],
    });
  } catch (err) {
    console.error('[chain] policyIsFrozen error:', err.message);
    return false;
  }
}

export async function policyIsSanctioned(wallet) {
  if (!POLICY_MANAGER_ADDRESS) return false;
  try {
    return await getPublicClient().readContract({
      address: POLICY_MANAGER_ADDRESS,
      abi: POLICY_MANAGER_ABI,
      functionName: 'sanctionsList',
      args: [getAddress(wallet)],
    });
  } catch (err) {
    console.error('[chain] policyIsSanctioned error:', err.message);
    return false;
  }
}

// ─── Transaction helper ──────────────────────────────────────────────────────

/**
 * Send a transaction and wait for 1 confirmation.
 * Returns { txHash } on success or throws a structured error.
 */
async function sendTx({ address, abi, functionName, args }) {
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();

  let hash;
  try {
    hash = await walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      account: getAccount(),
    });
  } catch (err) {
    // Parse common viem errors
    const msg = err.message || '';
    if (msg.includes('insufficient funds') || msg.includes('InsufficientFundsError')) {
      const e = new Error('INSUFFICIENT_GAS');
      e.code = 'INSUFFICIENT_GAS';
      throw e;
    }
    if (msg.includes('nonce too low') || msg.includes('NonceTooLowError')) {
      // Retry once with fresh nonce — viem handles this automatically on re-call
      hash = await walletClient.writeContract({
        address,
        abi,
        functionName,
        args,
        account: getAccount(),
      });
    } else {
      // Extract revert reason if present
      const revertMatch = msg.match(/reverted with reason: "([^"]+)"/);
      const reason = revertMatch ? revertMatch[1] : msg;
      const e = new Error(`TX_REVERTED: ${reason}`);
      e.code = 'TX_REVERTED';
      e.reason = reason;
      throw e;
    }
  }

  // Wait for 1 confirmation
  try {
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  } catch (err) {
    // Tx was sent but confirmation timed out — return the hash anyway
    console.warn(`[chain] waitForTransactionReceipt timeout for ${hash}: ${err.message}`);
  }

  return hash;
}

// ─── CCIDRegistry write calls ────────────────────────────────────────────────

export async function registerIdentity(wallet, tier, credentialHash) {
  if (!CCID_REGISTRY_ADDRESS) {
    throw Object.assign(new Error('CCID_REGISTRY_ADDRESS not configured'), { code: 'CONFIG_ERROR' });
  }
  const tierNum = typeof tier === 'string' ? TIER_MAP[tier] : tier;
  if (!tierNum) throw Object.assign(new Error('Invalid tier'), { code: 'INVALID_TIER' });

  const txHash = await sendTx({
    address: CCID_REGISTRY_ADDRESS,
    abi: CCID_ABI,
    functionName: 'registerIdentity',
    args: [getAddress(wallet), tierNum, credentialHash],
  });
  return txHash;
}

export async function revokeIdentity(wallet) {
  if (!CCID_REGISTRY_ADDRESS) {
    throw Object.assign(new Error('CCID_REGISTRY_ADDRESS not configured'), { code: 'CONFIG_ERROR' });
  }
  const txHash = await sendTx({
    address: CCID_REGISTRY_ADDRESS,
    abi: CCID_ABI,
    functionName: 'revokeIdentity',
    args: [getAddress(wallet)],
  });
  return txHash;
}

// ─── PolicyManager write calls ───────────────────────────────────────────────

export async function freezeWallet(wallet) {
  if (!POLICY_MANAGER_ADDRESS) {
    throw Object.assign(new Error('POLICY_MANAGER_ADDRESS not configured'), { code: 'CONFIG_ERROR' });
  }
  const txHash = await sendTx({
    address: POLICY_MANAGER_ADDRESS,
    abi: POLICY_MANAGER_ABI,
    functionName: 'freezeWallet',
    args: [getAddress(wallet)],
  });
  return txHash;
}

export async function unfreezeWallet(wallet) {
  if (!POLICY_MANAGER_ADDRESS) {
    throw Object.assign(new Error('POLICY_MANAGER_ADDRESS not configured'), { code: 'CONFIG_ERROR' });
  }
  const txHash = await sendTx({
    address: POLICY_MANAGER_ADDRESS,
    abi: POLICY_MANAGER_ABI,
    functionName: 'unfreezeWallet',
    args: [getAddress(wallet)],
  });
  return txHash;
}

export async function addToSanctions(wallet) {
  if (!POLICY_MANAGER_ADDRESS) {
    throw Object.assign(new Error('POLICY_MANAGER_ADDRESS not configured'), { code: 'CONFIG_ERROR' });
  }
  const txHash = await sendTx({
    address: POLICY_MANAGER_ADDRESS,
    abi: POLICY_MANAGER_ABI,
    functionName: 'addToSanctions',
    args: [getAddress(wallet)],
  });
  return txHash;
}

// ─── StablecoinBOB — emergency mint (agent as minter, no CRE) ────────────────

const BOBC_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
];

// Per-wallet profile cache: { [wallet]: { data, ts } }
const _profileCache = {};
const PROFILE_TTL = 30_000;

export async function getWalletProfile(wallet) {
  const now = Date.now();
  const cached = _profileCache[wallet.toLowerCase()];
  if (cached && now - cached.ts < PROFILE_TTL) return cached.data;

  if (!CCID_REGISTRY_ADDRESS || !POLICY_MANAGER_ADDRESS) {
    return { isValid: false, tier: 0, tierName: 'NONE', frozen: false, sanctioned: false };
  }

  const addr = getAddress(wallet);
  const client = getPublicClient();

  const results = await client.multicall({
    contracts: [
      { address: CCID_REGISTRY_ADDRESS, abi: CCID_ABI, functionName: 'isValid', args: [addr] },
      { address: CCID_REGISTRY_ADDRESS, abi: CCID_ABI, functionName: 'getTier', args: [addr] },
      { address: POLICY_MANAGER_ADDRESS, abi: POLICY_MANAGER_ABI, functionName: 'frozenWallets', args: [addr] },
      { address: POLICY_MANAGER_ADDRESS, abi: POLICY_MANAGER_ABI, functionName: 'sanctionsList', args: [addr] },
    ],
    allowFailure: true,
  });

  const isValid   = results[0].status === 'success' ? results[0].result : false;
  const tier      = results[1].status === 'success' ? Number(results[1].result) : 0;
  const frozen    = results[2].status === 'success' ? results[2].result : false;
  const sanctioned = results[3].status === 'success' ? results[3].result : false;

  const data = { isValid, tier, tierName: TIER_NAME_MAP[tier] ?? 'NONE', frozen, sanctioned };
  _profileCache[wallet.toLowerCase()] = { data, ts: now };
  return data;
}

export async function getTotalSupply() {
  if (!BOBC_ADDRESS) return 0;
  const client = getClient();
  const raw = await client.readContract({
    address: BOBC_ADDRESS,
    abi: BOBC_ABI,
    functionName: 'totalSupply',
  });
  return Number(raw) / 1e18;
}

// amount in BOB (not scaled) — function scales to 18 decimals internally
export async function mintTokens(to, amountBs) {
  if (!BOBC_ADDRESS) {
    throw Object.assign(new Error('BOBC_ADDRESS not configured'), { code: 'CONFIG_ERROR' });
  }
  const amountScaled = BigInt(Math.round(amountBs)) * 10n ** 18n;
  const txHash = await sendTx({
    address: BOBC_ADDRESS,
    abi: BOBC_ABI,
    functionName: 'mint',
    args: [getAddress(to), amountScaled],
  });
  return txHash;
}
