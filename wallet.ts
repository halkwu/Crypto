import fs from 'fs';
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
      // Print the full signature object
      try {
        console.log('    Raw signature object:');
        console.log(JSON.stringify(s, null, 2));
      } catch (e) {
        console.log('    Unable to serialize signature object:', e);
      }

      // If a parsed transaction exists, print the full parsed object (transaction + meta)
      if (parsed) {
        console.log('    Full parsed transaction info:');
        try {
          console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
          console.log('    Unable to serialize parsed transaction:', e);
        }
      } else {
        // If getParsedTransaction returns null, try getTransaction to fetch the raw transaction and print
        try {
          const raw = await conn.getTransaction(s.signature);
          console.log('    Could not parse transaction; printing raw transaction:');
          console.log(JSON.stringify(raw, null, 2));
        } catch (e: any) {
          console.log('    Error fetching raw transaction:', e?.message ?? e);
        }
      }
    }
  } catch (err: any) {
    console.log('Error querying transaction history:', err?.message ?? err);
  }
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function requestAirdropWithRetry(conn: Connection, pubkey: PublicKey, lamports: number, maxAttempts = 6) {
  let attempt = 0;
  let delay = 500;
  while (attempt < maxAttempts) {
    try {
      attempt++;
      console.log(`Attempting airdrop (attempt ${attempt}/${maxAttempts})...`);
      const sig = await conn.requestAirdrop(pubkey, lamports);
      return sig;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.log(`airdrop error: ${msg}`);
      if (/airdrop limit|faucet has run dry|Too Many Requests/i.test(msg)) {
        console.log('Detected airdrop limit or faucet drained; stopping retries.');
        return null;
      }
      await sleep(delay);
      delay *= 2;
    }
  }
  return null;
}

async function main() {
  // 1️⃣ Load existing wallet.json if present, otherwise generate a new wallet and save it
  const walletPath = 'wallet.json';
  let wallet: Keypair;
  if (fs.existsSync(walletPath)) {
    try {
      const raw = fs.readFileSync(walletPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.secretKey)) {
        wallet = Keypair.fromSecretKey(Uint8Array.from(parsed.secretKey));
        console.log('Loaded wallet from wallet.json:', wallet.publicKey.toBase58());
      } else {
        throw new Error('wallet.json has invalid format');
      }
    } catch (e) {
      console.log('Failed to read wallet.json, generating a new wallet:', e);
      wallet = Keypair.generate();
      const out = { publicKey: wallet.publicKey.toBase58(), secretKey: Array.from(wallet.secretKey) };
      fs.writeFileSync(walletPath, JSON.stringify(out, null, 2));
      console.log('Saved new wallet to wallet.json', wallet.publicKey.toBase58());
    }
  } else {
    wallet = Keypair.generate();
    const out = { publicKey: wallet.publicKey.toBase58(), secretKey: Array.from(wallet.secretKey) };
    fs.writeFileSync(walletPath, JSON.stringify(out, null, 2));
    console.log('Generated and saved wallet to wallet.json:', wallet.publicKey.toBase58());
  }

  console.log('=== Wallet Info ===');
  console.log('Public Key:', wallet.publicKey.toBase58());
  console.log('Secret Key (store securely!):', wallet.secretKey.toString());

  // 2️⃣ Connect to Devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  console.log("Connected to Devnet");

  // Check balance
  const senderBalance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", senderBalance / LAMPORTS_PER_SOL, "SOL");

  // 4️⃣ If a recipient address is provided via command line, send SOL to it
  // Usage: npx ts-node wallet.ts [recipientAddress] [amountSOL]
  const args = process.argv.slice(2);
  const recipientArg = args[0] ?? null;
  const amountArg = args[1] ?? '0.1';
  const amountSOL = Number(amountArg) || 0.1;

  if (recipientArg) {
    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(recipientArg);
    } catch (e) {
      console.error('Invalid recipient address:', recipientArg);
      process.exit(1);
    }

    const requiredLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

    // Check balance, attempt airdrop if insufficient
    let currentBalance = await connection.getBalance(wallet.publicKey);
    if (currentBalance < requiredLamports) {
      console.log(`Current balance ${currentBalance / LAMPORTS_PER_SOL} SOL is insufficient to send ${amountSOL} SOL, attempting airdrop...`);
      const sig = await requestAirdropWithRetry(connection, wallet.publicKey, Math.max(requiredLamports - currentBalance, 1 * LAMPORTS_PER_SOL));
      if (!sig) {
        console.error('Unable to obtain sufficient test SOL; aborting transfer.');
        process.exit(1);
      }
      await connection.confirmTransaction(sig);
      currentBalance = await connection.getBalance(wallet.publicKey);
    }

    // Send SOL
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: recipientPubkey,
        lamports: requiredLamports
      })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(`Sent ${amountSOL} SOL to ${recipientPubkey.toBase58()}, transaction signature:`, sig);

    // Final balances
    const finalSenderBalance = await connection.getBalance(wallet.publicKey);
    const recipientBalance = await connection.getBalance(recipientPubkey);
    console.log('Sender balance:', finalSenderBalance / LAMPORTS_PER_SOL, 'SOL');
    console.log('Recipient balance:', recipientBalance / LAMPORTS_PER_SOL, 'SOL');
    // Print transaction history (sender and recipient)
    await printTransactionHistory(connection, wallet.publicKey, 10);
    await printTransactionHistory(connection, recipientPubkey, 5);
  } else {
    console.log('No recipient provided; script will only generate/load wallet and attempt airdrop (if available).');
    // Print final balance and transaction history
    const final = await connection.getBalance(wallet.publicKey);
    console.log('Final wallet balance:', final / LAMPORTS_PER_SOL, 'SOL');
    await printTransactionHistory(connection, wallet.publicKey, 10);
  }
}

main().catch(console.error);