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
        const p = saveWallets(wallets, argv[1] || 'wallet.json');
        console.log(JSON.stringify(wallets[0], null, 2));
      } break;
      case 'balance': {
        const out = await getBalanceObject(argv[1]);
        console.log(JSON.stringify(out, null, 2));
      } break;
      case 'send': await send(argv[1], argv[2], argv[3]); break;
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
  secretKey: number[];
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
      secretKey: Array.from(kp.secretKey),
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

// Helper to print transaction history for an address
export async function printTransactionHistory(conn: Connection, pubkey: PublicKey, limit = 1000) {
  try {
    console.log(`\nLast ${limit} transactions (address ${pubkey.toBase58()}):`);
    const sigs = await conn.getSignaturesForAddress(pubkey, { limit });
    if (!sigs || sigs.length === 0) {
      console.log('  No transaction history');
      return;
    }
    for (const s of sigs) {
      const parsed = await conn.getParsedTransaction(s.signature);
      const time = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : 'n/a';
      const status = s.err ? 'failed' : 'success';
      console.log(`  Signature: ${s.signature}  slot: ${s.slot}  time: ${time}  status: ${status}`);
      try { console.log('    Raw signature object:'); console.log(JSON.stringify(s, null, 2)); } catch (e) { /* ignore */ }
      if (parsed) {
        try { console.log('    Full parsed transaction info:'); console.log(JSON.stringify(parsed, null, 2)); } catch (e) { /* ignore */ }
      } else {
        try { const raw = await conn.getTransaction(s.signature); console.log('    Raw transaction:'); console.log(JSON.stringify(raw, null, 2)); } catch (e) { /* ignore */ }
      }
    }
  } catch (err: any) {
    console.log('Error querying transaction history:', err?.message ?? err);
  }
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


export async function send(senderSecretOrFile: string, recipientArg: string, amountArg = '0.1') {
  if (!recipientArg) { console.error('Usage: npx ts-node solana.ts send <senderPrivateKey> <toAddress> [amount]'); process.exit(1); }
  let recipientPubkey: PublicKey;
  try { recipientPubkey = new PublicKey(recipientArg); } catch (e) { console.error('Invalid recipient address'); process.exit(1); }
  let sender: Keypair;
  try {
    sender = parseSecretToKeypair(senderSecretOrFile);
  } catch (e: any) {
    console.error('Failed to load sender key:', e?.message ?? e);
    process.exit(1);
  }
  const amountSOL = Number(amountArg) || 0.1;
  const requiredLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
  const conn = getConnection();
  let current = await conn.getBalance(sender.publicKey);
  if (current < requiredLamports) {
    console.error('Insufficient balance and airdrop/faucet functionality has been removed. Please fund the sender account and try again.');
    process.exit(1);
  }
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipientPubkey, lamports: requiredLamports }));
  const sig = await sendAndConfirmTransaction(conn, tx, [sender]);
  console.log(`Sent ${amountSOL} SOL to ${recipientPubkey.toBase58()}, signature:`, sig);
  console.log('Sender balance:', (await conn.getBalance(sender.publicKey)) / LAMPORTS_PER_SOL, 'SOL');
}


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

    txs.push({
      Signature: s.signature,
      time,
      from: (from || '').toLowerCase(),
      to: (to || '').toLowerCase(),
      amount: amountSol,
      fee: String(fee),
      currency: 'SOL',
      status: status === 'failed' ? 'failed' : 'confirmed'
    });
  }
  const out = { address, network: 'devnet', txs };
  console.log(JSON.stringify(out, null, 2));
  return out;
}
