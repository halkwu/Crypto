import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { getConnection, getBalanceObject, parseSecretToKeypair, generateKeypairs, saveWallets, getTxs } from './solana';

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get('/balance', async (req, res) => {
  const address = String(req.query.address || '');
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const out = await getBalanceObject(address);
    return res.json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

app.get('/txs', async (req, res) => {
  const address = String(req.query.address || '');
  const limit = req.query.limit || undefined;
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const out = await getTxs(address, limit ? String(limit) : undefined);
    return res.json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

// POST /generate - generate wallets (count, label) and optionally save to disk
app.post('/generate', async (req, res) => {
  const { count = 1, label = 'solana-wallet', save = false, outputPath } = req.body || {};
  const n = Number(count) || 1;
  try {
    const wallets = generateKeypairs(n, String(label || 'solana-wallet'));
    if (save || outputPath) {
      try {
        const p = saveWallets(wallets, outputPath || 'wallet.json');
        return res.json({ generated: wallets.length, wallets, path: p });
      } catch (err: any) {
        return res.status(500).json({ error: 'failed to save wallets', detail: err?.message ?? err });
      }
    }
    return res.json({ generated: wallets.length, wallets });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

app.post('/send', async (req, res) => {
  const { senderSecret, to, amount = '0.1' } = req.body || {};
  if (!to) return res.status(400).json({ error: 'recipient `to` is required' });
  if (!senderSecret) return res.status(400).json({ error: 'sender private key `senderSecret` is required (JSON array or comma-separated numbers)' });
  try {
    const senderKeypair = parseSecretToKeypair(String(senderSecret));

    const conn = getConnection();
    const amountSOL = Number(amount) || 0.1;
    const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
    let current = await conn.getBalance(senderKeypair.publicKey);
    if (current < lamports) {
      return res.status(400).json({ error: 'insufficient balance; airdrop/faucet functionality is disabled' });
    }

    const recipient = new PublicKey(String(to));
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: senderKeypair.publicKey, toPubkey: recipient, lamports }));
    const sig = await sendAndConfirmTransaction(conn, tx, [senderKeypair]);
    const newBal = await conn.getBalance(senderKeypair.publicKey);
    return res.json({ hash: sig, from: senderKeypair.publicKey.toBase58(), to: recipient.toBase58(), amount: amountSOL, senderBalance: newBal / LAMPORTS_PER_SOL });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});


const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Solana REST API listening on http://localhost:${port}`));

export default app;


