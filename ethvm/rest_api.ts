/// <reference path="./types.d.ts" />
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { providers, Wallet, utils } from 'ethers';
import { queryBalance } from './ethvm';
import axios from 'axios';
import path from 'path';

// local copy of fetchTransactions (mirrors ethvm/api.ts) to avoid runtime module resolution
async function fetchTransactionsLocal(address: string, limit?: number) {
  if (!address) throw new Error('address required');

  const wantAll = !limit || limit <= 0;
  const apiKey = process.env.ETHERSCAN_API_KEY;

  // Etherscan pagination: loop pages until fewer results than pageSize or we hit the requested limit
  if (apiKey) {
    const all: any[] = [];
    const pageSize = wantAll ? 10000 : Math.min(Math.max(10, limit || 10), 10000);
    let page = 1;
    while (true) {
      const url =
        `https://api.etherscan.io/v2/api` +
        `?chainid=11155111` +
        `&module=account&action=txlist` +
        `&address=${address}` +
        `&startblock=0&endblock=99999999` +
        `&page=${page}&offset=${pageSize}&sort=desc` +
        `&apikey=${apiKey}`;

      const r = await axios.get(url);
      const data = r.data || {};
      if (data.status !== '1' || !Array.isArray(data.result)) break;
      const pageItems = data.result || [];
      all.push(...pageItems);
      if (pageItems.length < pageSize) break;
      if (!wantAll && all.length >= (limit || 0)) break;
      page += 1;
    }

    const sliced = wantAll ? all : all.slice(0, limit as number);
    return sliced.map((tx: any) => ({
      txHash: tx.hash,
      time: tx.timeStamp ? new Date(Number(tx.timeStamp) * 1000).toISOString() : null,
      from: tx.from,
      to: tx.to,
      amount: tx.value,
      fee: tx.gasUsed && tx.gasPrice ? String(BigInt(tx.gasUsed) * BigInt(tx.gasPrice)) : null,
      status: tx.isError === '0' ? 'confirmed' : 'failed',
      raw: tx
    }));
  }

  // Alchemy pagination using pageKey
  const alchemy = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_MAINNET_RPC || process.env.ALCHEMY_RPC;
  if (alchemy) {
    const all: any[] = [];
    let pageKey: string | undefined = undefined;
    const pageSize = 100; // reasonable default for alchemy
    do {
      const body: any = {
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getAssetTransfers',
        params: [{
          fromBlock: '0x0',
          toBlock: 'latest',
          fromAddress: address,
          toAddress: undefined,
          maxCount: pageSize,
          category: ['external', 'internal'],
          pageKey
        }]
      };
      const r = await axios.post(alchemy, body, { headers: { 'Content-Type': 'application/json' } });
      const result = r.data?.result || {};
      const transfers = result.transfers || [];
      all.push(...transfers);
      pageKey = result.pageKey;
      if (!wantAll && all.length >= (limit || 0)) break;
    } while (pageKey);

    const sliced = wantAll ? all : all.slice(0, limit as number);
    return sliced.map((t: any) => ({
      txHash: t.hash || t.transactionHash,
      time: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp).toISOString() : null,
      from: t.from,
      to: t.to,
      amount: t.value || t.delta,
      status: 'unknown',
      raw: t
    }));
  }

  return [];
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

function getProvider() {
  const rpc = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_RPC || process.env.ALCHEMY_MAINNET_RPC;
  if (rpc) return new providers.JsonRpcProvider(rpc, 'sepolia');
  return providers.getDefaultProvider('sepolia', { etherscan: process.env.ETHERSCAN_API_KEY });
}

function isValidPrivateKey(k: string | undefined): k is string {
  if (!k || typeof k !== 'string') return false;
  return /^0x[0-9a-fA-F]{64}$/.test(k);
}

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

app.get('/txs', async (req, res) => {
  const address = String(req.query.address || '');
  const limit = Number(req.query.limit || 10);
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
      const txs = await fetchTransactionsLocal(address, limit);
    return res.json({ address, txs });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

app.post('/send', async (req, res) => {
  const { fromPrivateKey, to, amount } = req.body || {};
  if (!fromPrivateKey || !to) return res.status(400).json({ error: 'fromPrivateKey and to are required' });
  if (!isValidPrivateKey(fromPrivateKey)) return res.status(400).json({ error: 'invalid private key format' });
  try {
    const provider = getProvider();
    const wallet = new Wallet(fromPrivateKey, provider);
    const tx = await wallet.sendTransaction({ to, value: utils.parseEther(String(amount || '0.001')) });
    try {
      const receipt = await tx.wait();
      return res.json({ hash: tx.hash, receipt });
    } catch (err: any) {
      return res.json({ hash: tx.hash, info: 'sent (wait failed)', error: err?.message ?? err });
    }
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? e });
  }
});

app.post('/generate', async (req, res) => {
  const { count = 1, label = 'sepolia-wallet' } = req.body || {};
  const n = Number(count) || 1;
  const wallets: any[] = [];
  for (let i = 0; i < n; i++) {
    const w = Wallet.createRandom();
    wallets.push({
      label: n > 1 ? `${label}-${i + 1}` : label,
      address: w.address,
      privateKey: w.privateKey,
      mnemonic: w.mnemonic?.phrase ?? null,
      createdAt: new Date().toISOString(),
    });
  }
  return res.json({ generated: wallets.length, wallets });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`EthVM REST API listening on http://localhost:${port}`));

export default app;
