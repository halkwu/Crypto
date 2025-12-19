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

export async function printHelp() {
  console.log(`Usage: npx ts-node solana.ts <command> [args]\n
Commands:
  balance <address>                      Print address balance (SOL) only
  txs <address> [limit]                  Show recent transactions for address
  generate [outputPath] [label]          Generate a new wallet and save to JSON (default: wallet.json, solana-wallet)
  send <senderPrivateKey> <RECIPIENT_ADDRESS> [amount]   Send SOL from sender to recipient (provide private key as a JSON array string or comma-separated numbers, e.g. "[1,2,3,...]")
  help                                   Show this help
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  try {
    switch (cmd) {
      case 'generate': {
        const wallets = generateKeypairs(1, argv[2] || 'solana-wallet');
        console.log(JSON.stringify(wallets[0], null, 2));
      } break;
      case 'balance': {
        const out = await getBalanceObject(argv[1]);
        console.log(JSON.stringify(out, null, 2));
      } break;
      case 'send': {
        const res = await sendTransaction(argv[1], argv[2], argv[3]);
        console.log(`Sent ${res.amount} SOL to ${res.to}, signature:`, res.Signature);
        if (typeof res.senderBalance !== 'undefined') console.log('Sender balance:', res.senderBalance, 'SOL');
      } break;
      case 'txs': await getTxs(argv[1], argv[2]); break;
      case 'help': await printHelp(); break;
      default: console.error('Unknown or missing command'); await printHelp(); process.exit(1);
    }
  } catch (e: any) {
    console.error('Error:', e?.message ?? e);
    process.exit(1);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

export function getConnection() { return new Connection(clusterApiUrl("devnet"), "confirmed"); }

export interface SolanaWalletInfo {
  label: string;
  address: string;
  PrivateKey: number[];
  createdAt: string;
}

// Generate Solana wallets
export function generateKeypairs(count = 1, label = 'solana-wallet'): SolanaWalletInfo[] {
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
export function parseSecretToKeypair(secret: string): Keypair {
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
  let pub: PublicKey;
  try { pub = new PublicKey(address); } catch (e) { throw new Error('Invalid address'); }
  const conn = getConnection();
  const bal = await conn.getBalance(pub);
  return bal / LAMPORTS_PER_SOL;
}

// `getBalanceObject` CLI helper removed. Use `getBalanceObject` for programmatic access.
export async function getBalanceObject(address: string): Promise<{ address: string; network: string; balance: string; currency: string }> {
  const bal = await getBalanceValue(address);
  return {
    address,
    network: 'devnet',
    balance: String(bal),
    currency: 'SOL'
  };
}


export async function sendTransaction(senderSecret: string, recipientArg: string, amountArg?: string): Promise<{ Signature: string; time: string | null; from: string; to: string; amount: string; fee: string; currency: string; status: string; senderBalance?: number }> {
  if (!recipientArg) throw new Error('recipient required');
  let recipientPubkey: PublicKey;
  try { recipientPubkey = new PublicKey(recipientArg); } catch (e) { throw new Error('Invalid recipient address'); }
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
  const sig = await sendAndConfirmTransaction(conn, tx, [sender]);

  // Try to fetch parsed transaction to get time, fee and status
  let parsed: any = null;
  try {
    parsed = await conn.getParsedTransaction(sig, 'confirmed');
  } catch (e) {
    // ignore
  }

  const time = parsed?.blockTime ? new Date(parsed.blockTime * 1000).toISOString() : null;
  const fee = parsed?.meta?.fee ? String(parsed.meta.fee / LAMPORTS_PER_SOL) : '0';
  const status = parsed?.meta ? (parsed.meta.err ? 'failed' : 'confirmed') : 'pending';
  const newBal = await conn.getBalance(sender.publicKey);

  return {
    Signature: sig,
    time,
    from: sender.publicKey.toBase58(),
    to: recipientPubkey.toBase58(),
    amount: String(amountSOL),
    fee,
    currency: 'SOL',
    status,
    senderBalance: newBal / LAMPORTS_PER_SOL,
  };
}

// Helper to get transactions for an address
export async function getTxs(address: string, limitArg = '1000') {
  if (!address) { console.error('Usage: npx ts-node solana.ts txs <address> [limit]'); process.exit(1); }
  let pub: PublicKey;
  try { pub = new PublicKey(address); } catch (e) { console.error('Invalid address'); process.exit(1); }
  const limit = Number(limitArg) || 1000;
  const conn = getConnection();

  const sigs = await conn.getSignaturesForAddress(pub, { limit });
  const txs: Array<any> = [];
  for (const s of sigs) {
    const parsed = await conn.getParsedTransaction(s.signature, 'confirmed');
    const time = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null;
    const status = s.err ? 'failed' : 'confirmed';
    const fee = parsed?.meta?.fee ? String(parsed.meta.fee / LAMPORTS_PER_SOL) : '0';

    let from = '';
    let to = '';
    let amount = '0';

    // Try to extract from parsed instructions (system transfers, token transfers, etc.)
    try {
      const instructions = (parsed as any)?.transaction?.message?.instructions || [];
      for (const instr of instructions) {
        const p = instr.parsed || (instr as any).program ? instr : null;
        if (p && p.parsed && p.parsed.info) {
          const info = p.parsed.info;
          if (info.source || info.from) from = info.source || info.from;
          if (info.destination || info.to) to = info.destination || info.to;
          if (info.lamports !== undefined) amount = String(info.lamports);
          if (info.amount !== undefined) amount = String(info.amount);
          if (from || to || amount !== '0') break;
        }
      }
    } catch (e) {
      // ignore parsing errors
    }

    // Fallback: infer amount using pre/post balances and account key positions
    if ((amount === '0' || !from || !to) && parsed?.meta && parsed.transaction?.message?.accountKeys) {
      const accountKeys = parsed.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
      const pre = parsed.meta.preBalances || [];
      const post = parsed.meta.postBalances || [];
      const idx = accountKeys.indexOf(address);
      if (idx >= 0 && pre[idx] !== undefined && post[idx] !== undefined) {
        const diff = post[idx] - pre[idx];
        amount = String(Math.abs(diff));
        if (diff > 0) { from = accountKeys.find((k: string) => k !== address) || ''; to = address; }
        else { from = address; to = accountKeys.find((k: string) => k !== address) || ''; }
      } else {
        from = accountKeys[0] || '';
        to = accountKeys[1] || '';
      }
    }

    // Convert amount (likely lamports) to SOL when numeric; otherwise leave as-is
    let amountSol = String(amount);
    try {
      const n = Number(amount);
      if (!Number.isNaN(n)) {
        amountSol = String(n / LAMPORTS_PER_SOL);
      }
    } catch (e) {
      // keep original amount string if conversion fails
    }

    // Determine post-transaction balance for the requested address (if available)
    let balanceAfter: string | null = null;
    try {
      if (parsed && parsed.transaction?.message?.accountKeys) {
        const accountKeys = parsed.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
        const post = parsed?.meta?.postBalances || [];
        const idx2 = accountKeys.indexOf(address);
        if (idx2 >= 0 && post[idx2] !== undefined) balanceAfter = String(post[idx2] / LAMPORTS_PER_SOL);
      }
    } catch (e) {
      // ignore if unable to determine balance
    }

    txs.push({
      Signature: s.signature,
      time,
      from: (from || '').toLowerCase(),
      to: (to || '').toLowerCase(),
      amount: amountSol,
      fee: String(fee),
      currency: 'SOL',
      status: status === 'failed' ? 'failed' : 'confirmed',
      balance: balanceAfter
    });
  }
  const out = { address, network: 'devnet', txs };
  console.log(JSON.stringify(out, null, 2));
  return out;
}
