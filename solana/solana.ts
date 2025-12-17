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

async function printTransactionHistory(conn: Connection, pubkey: PublicKey, limit = 10) {
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

async function sleep(ms: number) { return new Promise((res) => setTimeout(res, ms)); }

async function requestAirdropWithRetry(conn: Connection, pubkey: PublicKey, lamports: number, maxAttempts = 6) {
  let attempt = 0; let delay = 500;
  while (attempt < maxAttempts) {
    try {
      attempt++;
      console.log(`Attempting airdrop (attempt ${attempt}/${maxAttempts})...`);
      const sig = await conn.requestAirdrop(pubkey, lamports);
      return sig;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.log(`airdrop error: ${msg}`);
      if (/airdrop limit|faucet has run dry|Too Many Requests/i.test(msg)) return null;
      await sleep(delay);
      delay *= 2;
    }
  }
  return null;
}


function getConnection() { return new Connection(clusterApiUrl("devnet"), "confirmed"); }

function loadKeypairFromFile(file: string): Keypair {
  // Resolve common relative locations: exact path, relative to cwd, relative to this script's directory
  const candidates = [file, path.join(process.cwd(), file), path.join(__dirname, file)];
  let found: string | null = null;
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { found = c; break; } } catch (e) { /* ignore */ }
  }
  if (!found) throw new Error('key file not found: ' + file + ' (tried ' + candidates.join(', ') + ')');
  const raw = fs.readFileSync(found, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.secretKey)) throw new Error('invalid key file format');
  return Keypair.fromSecretKey(Uint8Array.from(parsed.secretKey));
}

function loadKeypairFromInput(input: string): Keypair {
  // If it's a file path, load from file
  if (fs.existsSync(input)) return loadKeypairFromFile(input);

  // Try parse as JSON (either array or object with secretKey)
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed));
    if (parsed && Array.isArray(parsed.secretKey)) return Keypair.fromSecretKey(Uint8Array.from(parsed.secretKey));
  } catch (e) {
    // ignore
  }

  // Try comma-separated numbers
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const nums = parts.map(s => Number(s)).filter(n => Number.isFinite(n));
  if (nums.length >= 32) return Keypair.fromSecretKey(Uint8Array.from(nums));

  throw new Error('Invalid secret input. Provide a path to a JSON keyfile, a JSON array string, or comma-separated numbers representing the secret key.');
}

async function getBalance(address: string) {
  if (!address) { console.error('Usage: npx ts-node solana.ts balance <address>'); process.exit(1); }
  let pub: PublicKey;
  try { pub = new PublicKey(address); } catch (e) { console.error('Invalid address'); process.exit(1); }
  const conn = getConnection();
  const bal = await conn.getBalance(pub);
  console.log('Balance:', bal / LAMPORTS_PER_SOL, 'SOL');
}

async function send(senderSecretOrFile: string, recipientArg: string, amountArg = '0.1') {
  if (!recipientArg) { console.error('Usage: npx ts-node solana.ts send <senderSecretOrFile> <toAddress> [amount]'); process.exit(1); }
  let recipientPubkey: PublicKey;
  try { recipientPubkey = new PublicKey(recipientArg); } catch (e) { console.error('Invalid recipient address'); process.exit(1); }
  let sender: Keypair;
  try {
    // If senderSecretOrFile omitted or falsy, try loading default solana/wallet.json
    if (!senderSecretOrFile) {
      // try script-local solana.json first, then project-root solana/wallet.json
      const localCandidates = [path.join(__dirname, 'wallet.json'), path.join(process.cwd(), 'solana', 'wallet.json'), path.join(process.cwd(), 'wallet.json')];
      let found: string | null = null;
      for (const c of localCandidates) { if (fs.existsSync(c)) { found = c; break; } }
      if (!found) throw new Error('No sender key provided and no default solana/wallet.json found');
      sender = loadKeypairFromFile(found);
    } else {
      sender = loadKeypairFromInput(senderSecretOrFile);
    }
  } catch (e: any) {
    console.error('Failed to load sender key:', e?.message ?? e);
    process.exit(1);
  }
  const amountSOL = Number(amountArg) || 0.1;
  const requiredLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
  const conn = getConnection();
  let current = await conn.getBalance(sender.publicKey);
  if (current < requiredLamports) {
    console.log('Insufficient balance, attempting airdrop...');
    const sig = await requestAirdropWithRetry(conn, sender.publicKey, Math.max(requiredLamports - current, LAMPORTS_PER_SOL));
    if (!sig) { console.error('Unable to obtain test SOL'); process.exit(1); }
    await conn.confirmTransaction(sig);
    current = await conn.getBalance(sender.publicKey);
  }
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipientPubkey, lamports: requiredLamports }));
  const sig = await sendAndConfirmTransaction(conn, tx, [sender]);
  console.log(`Sent ${amountSOL} SOL to ${recipientPubkey.toBase58()}, signature:`, sig);
  console.log('Sender balance:', (await conn.getBalance(sender.publicKey)) / LAMPORTS_PER_SOL, 'SOL');
}

async function requestFaucet(address: string, amountArg = '1') {
  if (!address) { console.error('Usage: npx ts-node solana.ts faucet <address> [amount]'); process.exit(1); }
  let pub: PublicKey;
  try { pub = new PublicKey(address); } catch (e) { console.error('Invalid address'); process.exit(1); }
  const amountSOL = Number(amountArg) || 1;
  const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
  const conn = getConnection();
  const sig = await requestAirdropWithRetry(conn, pub, lamports);
  if (!sig) { console.error('Airdrop failed'); process.exit(1); }
  await conn.confirmTransaction(sig);
  console.log('Airdrop confirmed. New balance:', (await conn.getBalance(pub)) / LAMPORTS_PER_SOL, 'SOL');
}

async function getTxs(address: string, limitArg = '10') {
  if (!address) { console.error('Usage: npx ts-node solana.ts txs <address> [limit]'); process.exit(1); }
  let pub: PublicKey;
  try { pub = new PublicKey(address); } catch (e) { console.error('Invalid address'); process.exit(1); }
  const limit = Number(limitArg) || 10;
  const conn = getConnection();
  await printTransactionHistory(conn, pub, limit);
}

async function printHelp() {
  console.log(`Usage: npx ts-node solana.ts <command> [args]\n
Commands:
  balance <address>                      Print address balance (SOL) only
  txs <address> [limit]                  Show recent transactions for address
  faucet <address> [amount]              Request test SOL airdrop to address (devnet)
  send <senderKeyFile.json>/<senderSecretKey> <RECIPIENT_ADDRESS> [amount]   Send SOL from sender to recipient(for example: npx ts-node solana.ts send "[1,2,3,...]" <RECIPIENT_ADDRESS> 0.01)
  help                                   Show this help
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  try {
    switch (cmd) {
      case 'balance': await getBalance(argv[1]); break;
      case 'send': await send(argv[1], argv[2], argv[3]); break;
      case 'faucet': await requestFaucet(argv[1], argv[2]); break;
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