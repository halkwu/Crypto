import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

// Example: GET /api/v1/txs?chain=ETH&account=0x...&limit=20
app.get('/api/v1/txs', (req, res) => {
  const chain = (req.query.chain || 'BTC') as string;
  const account = req.query.account as string || 'unknown';
  const limit = Number(req.query.limit || 20);

  // Return mocked txs for demo
  const txs = Array.from({ length: Math.min(limit, 10) }).map((_, i) => ({
    time: new Date(Date.now() - i * 3600_000).toISOString(),
    txHash: `${chain}-TX-${i}`,
    amount: `${(Math.random()*0.5).toFixed(6)}`,
    status: ['success','pending','failed'][i % 3]
  }));
  res.json(txs);
});

// POST /api/v1/transfer   body: { chain, fromAccount, to, amount, fee }
app.post('/api/v1/transfer', (req, res) => {
  const body = req.body;
  // Very small validation
  if (!body || !body.chain || !body.fromAccount || !body.to || !body.amount) {
    return res.status(400).json({ error: 'missing fields' });
  }

  // In a real API you'd call the chain-specific sender here.
  // Respond with a mocked tx id
  return res.json({ success: true, txHash: `${body.chain}-TX-${Math.floor(Math.random()*1e6)}` });
});

app.listen(3000, () => console.log('Unified API example listening on http://localhost:3000'));
