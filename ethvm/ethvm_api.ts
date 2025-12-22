import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { queryBalance, queryTransactions, generateWallets, saveWallets, sendTransaction } from './ethvm';

// local copy of fetchTransactions (mirrors ethvm/api.ts) to avoid runtime module resolution
const app = express();
app.use(cors());
app.use(bodyParser.json());

// validate private key format
function isValidPrivateKey(k: string | undefined): k is string {
  if (!k || typeof k !== 'string') return false;
  return /^0x[0-9a-fA-F]{64}$/.test(k);
}

// GET /balance - get balance for an address
app.get('/balance', async (req, res) => {
  const address = String(req.query.address || '');
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const info = await queryBalance(address);
    return res.json(info);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

//  GET /txs - get transactions for an address, optional limit
app.get('/txs', async (req, res) => {
  const address = String(req.query.address || '');
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
      const txs = await queryTransactions(address);
    // Return same shape as CLI: { address, network: 'Sepolia', transaction: [...] }
    const result = { address, network: 'Sepolia', transaction: txs };
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

// POST /send - send ETH from sender to recipient
app.post('/send', async (req, res) => {
  const { fromPrivateKey, to, amount } = req.body || {};
  if (!fromPrivateKey || !to) return res.status(400).json({ error: 'fromPrivateKey and to are required' });
  if (!isValidPrivateKey(fromPrivateKey)) return res.status(400).json({ error: 'invalid private key format' });
  try {
    if (!amount || String(amount).trim() === '') return res.status(400).json({ error: 'amount is required' });
    const result = await sendTransaction(fromPrivateKey, to, String(amount));
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

// POST /generate - generate wallets (count, label) and optionally save to disk
app.post('/generate', async (req, res) => {
  const { count = 1, label = 'sepolia-wallet' } = req.body || {};
  const n = Number(count) || 1;
  try {
    const wallets = await generateWallets(n, String(label || 'sepolia-wallet'));
    // optionally save to disk if requested
    const outputPath = req.body?.outputPath as string | undefined;
    const shouldSave = req.body?.save === true || !!outputPath;
    if (shouldSave) {
      try {
        saveWallets(wallets, outputPath || 'wallet.json');
      } catch (err: any) {
        return res.status(500).json({ error: 'failed to save wallets', detail: err?.message ?? err });
      }
    }
    return res.json({ generated: wallets.length, wallets });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`EthVM REST API listening on http://localhost:${port}`));

export default app;
