import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import {getBalanceObject, generateKeypairs, saveWallets, getTxs, sendTransaction } from './solana';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// GET /balance - get balance for an address
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

// GET /txs - get transactions for an address, optional limit
app.get('/txs', async (req, res) => {
  const address = String(req.query.address || '');
  const limit = req.query.limit || undefined;
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const out = await getTxs(address, limit ? String(limit) : undefined);
    // Normalize to { address, network, transaction: [...] } to match ethvm API
    const txsArray = Array.isArray((out as any).txs)
      ? (out as any).txs
      : Array.isArray((out as any).transaction)
      ? (out as any).transaction
      : [];
    const result = { address: (out as any).address || address, network: (out as any).network || 'devnet', transaction: txsArray };
    return res.json(result);
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

// POST /send - send SOL from sender to recipient
app.post('/send', async (req, res) => {
  const { senderSecret, to, amount } = req.body || {};
  if (!to) return res.status(400).json({ error: 'recipient `to` is required' });
  if (!senderSecret) return res.status(400).json({ error: 'sender private key `senderSecret` is required (JSON array or comma-separated numbers)' });
  try {
    const result = await sendTransaction(String(senderSecret), String(to), amount ? String(amount) : undefined);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});


const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Solana REST API listening on http://localhost:${port}`));

export default app;


