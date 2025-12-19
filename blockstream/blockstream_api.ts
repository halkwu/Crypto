import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { queryBalance, generateWallet, queryTransactions, sendTransaction, saveWallets } from './blockstream';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// GET /balance - get balance for an address
app.get('/balance', async (req, res) => {
  const address = String(req.query.address || '');
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const result = await queryBalance(address);
    return res.json(result);
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
    const result = await queryTransactions(address, limit ? Number(limit) : undefined);
    // Return normalized shape { address, network, transaction }
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

// POST /generate - generate wallets (count) and optionally save to disk
app.post('/generate', async (req, res) => {
  const { count = 1, save = false, outputPath, label } = req.body || {};
  const n = Number(count) || 1;
  try {
    const wallets = generateWallet(n, label || 'btc-wallet');
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

// POST /send - send BTC from sender to recipient
app.post('/send', async (req, res) => {
  const { to, amount, feeRate, wif } = req.body || {};
  if (!to) return res.status(400).json({ error: 'recipient `to` is required' });
  if (!amount) return res.status(400).json({ error: 'amount is required' });
  if (!wif) return res.status(400).json({ error: 'wif (private key) is required' });
  try {
    const result = await sendTransaction(String(wif), String(to), String(amount), { feeRate: feeRate ? Number(feeRate) : undefined });
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Blockstream REST API listening on http://localhost:${port}`));

export default app;
