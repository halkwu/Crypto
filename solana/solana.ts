import fs from 'fs';
import path from 'path';
import {
  Keypair,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  PublicKey
} from "@solana/web3.js";

function getConnection() { return new Connection(clusterApiUrl("devnet"), "confirmed"); }

function isValidAddress(address: string | undefined | null) {
  if (!address || typeof address !== 'string') return false;
  try {
    // PublicKey constructor will throw for invalid base58 or wrong length
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const p = new PublicKey(address);
    return true;
  } catch (e) {
    return false;
  }
}

interface SolanaWalletInfo {
  label: string;
  address: string;
  PrivateKey: number[];
  createdAt: string;
}

// Generate Solana wallets
export function generateWallets(count = 1, label = 'solana-wallet'): SolanaWalletInfo[] {
  const out: SolanaWalletInfo[] = [];
  for (let i = 0; i < count; i++) {
    const kp = Keypair.generate();
    out.push({
      label: count > 1 ? `${label}-${i + 1}` : label,
      address: kp.publicKey.toBase58(),
      PrivateKey: Array.from(kp.secretKey),
      createdAt: new Date().toISOString(),
    });
    console.log(`Generated ${out[out.length - 1].address}`);
  }
  return out;
}

// Save generated wallets to disk
export function saveWallets(wallets: SolanaWalletInfo[], outputPath = 'wallet.json') {
  const payload = { generated: wallets.length, wallets };
  const p = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${wallets.length} wallet(s) to ${p}`);
  return p;
}
// Parse a provided secret string into a Keypair.
function parseSecretToKeypair(secret: string): Keypair {
  if (!secret) throw new Error('secret is required');
  let nums: number[] = [];
  // Try JSON
  try {
    const parsed = JSON.parse(secret);
    if (Array.isArray(parsed)) nums = parsed.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
    else if (parsed && Array.isArray((parsed as any).secretKey)) nums = (parsed as any).secretKey.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
  } catch (e) {
    // ignore
  }

  // Try comma-separated numbers
  if (nums.length === 0) {
    const parts = String(secret).split(',').map(s => s.trim()).filter(Boolean);
    nums = parts.map(s => Number(s)).filter(n => Number.isFinite(n));
  }

  if (nums.length >= 64) return Keypair.fromSecretKey(Uint8Array.from(nums.slice(0, 64)));
  if (nums.length === 32) return Keypair.fromSeed(Uint8Array.from(nums));

  throw new Error('Invalid secret key format. Provide a JSON array of numbers (32 or 64 items) or comma-separated numbers.');
}

// `getBalance` CLI helper removed. Use `getBalanceValue` for programmatic access.
async function getBalanceValue(address: string): Promise<number> {
  if (!address) throw new Error('address required');
  if (!isValidAddress(address)) throw new Error('invalid address format');
  let pub: PublicKey = new PublicKey(address);
  const conn = getConnection();
  const bal = await conn.getBalance(pub);
  return bal / LAMPORTS_PER_SOL;
}

export async function queryBalance(id: string): Promise<{ id: string; name: string; balance: number; currency: string }> {
  const bal = await getBalanceValue(id);
  return {
    id: id,
    name: 'devnet',
    balance: bal,
    currency: 'SOL'
  };
}


export async function sendTransaction(senderSecret: string, recipientArg: string, amountArg?: string): Promise<{ transactionId: string; transactionTime: string | null; amount: number; currency: string; description: string; status: string; balance?: number }> {
  if (!recipientArg) throw new Error('recipient required');
  if (!isValidAddress(recipientArg)) throw new Error('invalid recipient address format');
  const recipientPubkey: PublicKey = new PublicKey(recipientArg);
  let sender: Keypair;
  try {
    sender = parseSecretToKeypair(senderSecret);
  } catch (e: any) {
    throw new Error('Failed to load sender key: ' + (e?.message ?? e));
  }
  const amountSOL = Number(amountArg) || 0.1;
  const requiredLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
  const conn = getConnection();
  let current = await conn.getBalance(sender.publicKey);
  if (current < requiredLamports) {
    throw new Error('Insufficient balance and airdrop/faucet functionality has been removed. Please fund the sender account and try again.');
  }
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipientPubkey, lamports: requiredLamports }));
  const transactionId = await sendAndConfirmTransaction(conn, tx, [sender]);

  // Try to fetch parsed transaction to get time, fee and status
  let parsed: any = null;
  try {
    parsed = await conn.getParsedTransaction(transactionId, 'confirmed');
  } catch (e) {
    // ignore
  }

  const time = parsed?.blockTime ? new Date(parsed.blockTime * 1000).toISOString() : null;
  const fee = parsed?.meta?.fee ? parsed.meta.fee / LAMPORTS_PER_SOL : 0;
  const status = parsed?.meta ? (parsed.meta.err ? 'failed' : 'confirmed') : 'pending';
  const newBal = await conn.getBalance(sender.publicKey);

  return {
    transactionId: transactionId,
    transactionTime: time,
    amount: amountSOL,
    currency: 'SOL',
    description: `from ${sender.publicKey.toBase58()} to:${recipientArg.toLowerCase()} fee:${String(fee || 0)}`,
    status,
    balance: newBal / LAMPORTS_PER_SOL,
  };
}

// Helper to get transactions for an address
export async function queryTransactions(id: string) {
  if (!id) throw new Error('address required');
  if (!isValidAddress(id)) throw new Error('invalid address format');
  const pub: PublicKey = new PublicKey(id);
  const conn = getConnection();
  const sigs = await conn.getSignaturesForAddress(pub);
  const transaction: Array<any> = [];

  // Get current balance (latest) and work backwards to infer prior balances
  let lastBalanceLam = await conn.getBalance(pub);
  const addrNorm = String(id).toLowerCase();

  for (const s of sigs) {
    const parsed = await conn.getParsedTransaction(s.signature, 'confirmed');
    const time = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null;
    const status = s.err ? 'failed' : 'confirmed';
    const feeNum = parsed?.meta?.fee ? Number(parsed.meta.fee) : 0;

    let from = '';
    let to = '';
    let amountLamports = 0;

    // Try to extract from parsed instructions (system transfers, token transfers, etc.)
    try {
      const instructions = (parsed as any)?.transaction?.message?.instructions || [];
      for (const instr of instructions) {
        const p = instr.parsed || (instr as any).program ? instr : null;
        if (p && p.parsed && p.parsed.info) {
          const info = p.parsed.info;
          if (info.source || info.from) from = info.source || info.from;
          if (info.destination || info.to) to = info.destination || info.to;
          if (info.lamports !== undefined) amountLamports = Number(info.lamports) || 0;
          if (info.amount !== undefined) amountLamports = Number(info.amount) || amountLamports;
          if (from || to || amountLamports !== 0) break;
        }
      }
    } catch (e) {
      // ignore parsing errors
    }

    // Fallback: infer amount using pre/post balances and account key positions
    try {
      if ((amountLamports === 0 || !from || !to) && parsed?.meta && parsed.transaction?.message?.accountKeys) {
        const accountKeys = parsed.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
        const pre = parsed.meta.preBalances || [];
        const post = parsed.meta.postBalances || [];
        const idx = accountKeys.indexOf(id);
        if (idx >= 0 && pre[idx] !== undefined && post[idx] !== undefined) {
          const diff = post[idx] - pre[idx];
          amountLamports = Math.abs(diff);
          if (diff > 0) { from = accountKeys.find((k: string) => k !== id) || ''; to = id; }
          else { from = id; to = accountKeys.find((k: string) => k !== id) || ''; }
        } else {
          from = accountKeys[0] || '';
          to = accountKeys[1] || '';
        }
      }
    } catch (e) {
      // ignore
    }

    // Determine balance after this transaction.
    // For the newest tx (first loop) `lastBalanceLam` is current on-chain balance.
    // If this parsed tx provides a postBalance for the address, prefer it; otherwise use lastBalanceLam.
    let balanceAfterLam: number | null = null;
    try {
      if (parsed && parsed.transaction?.message?.accountKeys) {
        const accountKeys = parsed.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
        const post = parsed?.meta?.postBalances || [];
        const idx2 = accountKeys.indexOf(id);
        if (idx2 >= 0 && post[idx2] !== undefined) balanceAfterLam = Number(post[idx2]);
      }
    } catch (e) {
      // ignore
    }
    if (balanceAfterLam === null) balanceAfterLam = lastBalanceLam;

    // Convert amount to SOL for output
    const amountSol = (amountLamports && !Number.isNaN(amountLamports)) ? amountLamports / LAMPORTS_PER_SOL : 0;
    const feeSol = feeNum / LAMPORTS_PER_SOL;

    transaction.push({
      transactionId: s.signature,
      transactionTime: time,
      amount: amountSol,
      currency: 'SOL',
      description: `from:${(from || '').toLowerCase()} to:${(to || '').toLowerCase()} fee:${String(feeSol || 0)}`,
      status: status === 'failed' ? 'failed' : 'confirmed',
      balance: balanceAfterLam !== null ? balanceAfterLam / LAMPORTS_PER_SOL : null
    });

    // Derive the balance that existed before this transaction (for the next, older tx)
    // Rule: if this (newer) tx `from` == address then the previous balance = after_balance + fee + amount
    //       if this (newer) tx `to` == address then previous balance = after_balance - amount
    // Otherwise, if preBalances available for this tx, use that; else keep lastBalance same.
    let prevBalanceLam: number | null = null;
    try {
      const fromNorm = (from || '').toLowerCase();
      const toNorm = (to || '').toLowerCase();
      if (fromNorm === addrNorm) {
        prevBalanceLam = Math.floor((balanceAfterLam || 0) + feeNum + (amountLamports || 0));
      } else if (toNorm === addrNorm) {
        prevBalanceLam = Math.floor((balanceAfterLam || 0) - (amountLamports || 0));
      }
    } catch (e) {
      // ignore
    }

    if (prevBalanceLam === null) {
      try {
        if (parsed && parsed.transaction?.message?.accountKeys) {
          const accountKeys = parsed.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
          const pre = parsed?.meta?.preBalances || [];
          const idx3 = accountKeys.indexOf(id);
          if (idx3 >= 0 && pre[idx3] !== undefined) prevBalanceLam = Number(pre[idx3]);
        }
      } catch (e) {
        // ignore
      }
    }

    if (prevBalanceLam === null) prevBalanceLam = balanceAfterLam || 0;
    lastBalanceLam = prevBalanceLam;
  }

  console.log(JSON.stringify(transaction, null, 2));
  return transaction;
}
