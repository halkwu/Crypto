import fs from 'fs';
import path from 'path';
import { Wallet, providers, utils, BigNumber } from 'ethers';

// Basic Ethereum address validation helper
export function isValidAddress(address: string | undefined | null) {
  if (!address || typeof address !== 'string') return false;
  try {
    return utils.isAddress(address);
  } catch (e) {
    return false;
  }
}

/**
 * =========================
 * Config & Types
 * =========================
 */

interface WalletConfig {
  mode: 'generate' | 'balance' | 'txs' | 'send';
  count: number;
  label: string;
  outputPath: string;
  address?: string;
  network: 'sepolia';
}

interface SendConfig {
  fromPrivateKey?: string;
  toAddress?: string;
  amount?: string;
}

export interface WalletInfo {
  label: string;
  address: string;
  privateKey: string;
  mnemonic: string | null;
  createdAt: string;
}

interface WalletOutput {
  generated: number;
  wallets: WalletInfo[];
}

// Exported reusable wallet generator for other modules (e.g. ethvm_api.ts)
export async function generateWallets(count: number, label = 'sepolia-wallet'): Promise<WalletInfo[]> {
  const wallets: WalletInfo[] = [];
  for (let i = 0; i < count; i++) {
    const w = Wallet.createRandom();
    wallets.push({
      label: count > 1 ? `${label}-${i + 1}` : label,
      address: w.address,
      privateKey: w.privateKey,
      mnemonic: w.mnemonic?.phrase ?? null,
      createdAt: new Date().toISOString(),
    });
    console.log(`Generated ${w.address}`);
  }
  return wallets;
}

// Exported helper to save wallets to disk
export function saveWallets(wallets: WalletInfo[], outputPath = 'wallet.json'): void {
  const output: WalletOutput = { generated: wallets.length, wallets };
  const p = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(p, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Saved ${wallets.length} wallet(s) to ${p}`);
}

// Exported reusable sendTransaction for external use (returns hash and optional receipt)
export interface SendResult {
  Signature: string;
  time: string | null;
  from: string;
  to: string;
  amount: number;
  fee: number | null;
  currency: string;
  status: 'pending' | 'confirmed' | 'failed' | 'unknown';
  balance?: number | null;
}

export async function sendTransaction(fromPrivateKey: string, to: string, amount: string, network = 'sepolia'): Promise<SendResult> {
  if (!amount || String(amount).trim() === '') throw new Error('amount is required');
  if (!isValidAddress(to)) throw new Error('invalid recipient address format');
  const apiKey = process.env.ETHERSCAN_API_KEY;
  const provider = apiKey
    ? providers.getDefaultProvider(network || 'sepolia', { etherscan: apiKey })
    : providers.getDefaultProvider(network || 'sepolia');

  const sender = new Wallet(fromPrivateKey, provider);
  const amtStr = String(amount);
  console.log(`Sending ${amtStr} ETH from ${sender.address} to ${to} on ${network}`);
  const tx = await sender.sendTransaction({ to, value: utils.parseEther(amtStr) });
  console.log(`Transaction submitted: ${tx.hash}`);

  let receipt: any = null;
  let status: SendResult['status'] = 'pending';
  let timeIso: string | null = null;
  let feeStr: string | null = null;
  try {
    receipt = await tx.wait();
    status = receipt && typeof receipt.status !== 'undefined' ? (receipt.status === 1 ? 'confirmed' : 'failed') : 'unknown';
    console.log(`Transaction ${tx.hash} status: ${status} block ${receipt.blockNumber}`);

    try {
      const block = receipt.blockNumber ? await provider.getBlock(receipt.blockNumber) : null;
      if (block && block.timestamp) timeIso = new Date(block.timestamp * 1000).toISOString();
      else timeIso = new Date().toISOString();
    } catch (e) {
      timeIso = new Date().toISOString();
    }

    try {
      let gasPrice = (receipt as any).effectiveGasPrice ? BigNumber.from((receipt as any).effectiveGasPrice) : undefined;
      if (!gasPrice) {
        const txFull = await provider.getTransaction(tx.hash);
        if (txFull && txFull.gasPrice) gasPrice = BigNumber.from(txFull.gasPrice as any);
      }
      if (receipt && receipt.gasUsed && gasPrice) {
        const fee = receipt.gasUsed.mul(gasPrice);
        feeStr = utils.formatEther(fee);
      }
    } catch (e) {
      feeStr = null;
    }
  } catch (err) {
    console.warn(`Error waiting for confirmation: ${err instanceof Error ? err.message : err}`);
    status = 'pending';
    timeIso = new Date().toISOString();
  }

  // get sender balance after tx
  let balanceStr: string | null = null;
  try {
    const bal = await provider.getBalance(sender.address);
    balanceStr = utils.formatEther(bal);
  } catch (e) {
    balanceStr = null;
  }

  const result: SendResult = {
    Signature: tx.hash,
    time: timeIso,
    from: sender.address,
    to,
    amount: (() => {
      const n = Number(amtStr);
      return Number.isFinite(n) ? n : parseFloat(amtStr) || 0;
    })(),
    fee: feeStr && !isNaN(Number(feeStr)) ? Number(feeStr) : null,
    currency: 'ETH',
    status,
    balance: balanceStr && !isNaN(Number(balanceStr)) ? Number(balanceStr) : null,
  };

  return result;
}

// Reusable helper for other modules (REST API) to get formatted balance
export async function queryBalance(address: string): Promise<{ address: string; network: string; balance: string;  currency: string; }> {
  if (!isValidAddress(address)) throw new Error('invalid address format');
  const rpc = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_RPC || process.env.ALCHEMY_MAINNET_RPC;
  const provider = rpc ? new providers.JsonRpcProvider(rpc, 'sepolia') : providers.getDefaultProvider('sepolia', { etherscan: process.env.ETHERSCAN_API_KEY });
  const balance = await provider.getBalance(address);
  const formatted = utils.formatEther(balance);
  return { address, network: 'Sepolia', balance: Number(formatted), currency: 'ETH' } as any;
}

// Reusable transaction query for other modules
export async function queryTransactions(address: string): Promise<any[]> {
  if (!address) throw new Error('address required');
  if (!isValidAddress(address)) throw new Error('invalid address format');

  const apiKey = process.env.ETHERSCAN_API_KEY;
  const rpc = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_RPC || process.env.ALCHEMY_MAINNET_RPC;
  const provider = rpc ? new providers.JsonRpcProvider(rpc, 'sepolia') : providers.getDefaultProvider('sepolia', { etherscan: apiKey });

  // Get current account balance (used as the balance after the newest tx)
  let currentBalanceNum = 0;
  try {
    const bal = await provider.getBalance(address);
    currentBalanceNum = Number(utils.formatEther(bal));
  } catch (e) {
    currentBalanceNum = 0;
  }

  // Try Etherscan first if API key available
    if (apiKey) {
    const maxCount = 10000;
    const url =
      `https://api.etherscan.io/v2/api` +
      `?chainid=11155111` +
      `&module=account&action=txlist` +
      `&address=${address}` +
      `&startblock=0&endblock=99999999` +
      `&page=1&offset=${maxCount}&sort=desc` +
      `&apikey=${apiKey}`;

    const res = await fetch(url);
    const data: any = await res.json().catch(() => ({} as any));
    if (!data || data.status !== '1' || !Array.isArray(data.result)) return [];

    const out: any[] = [];
    // Etherscan returns descending (newest first) when sort=desc — we treat index 0 as newest
    let prevBalance = currentBalanceNum;
    for (let i = 0; i < Math.min(data.result.length, maxCount); i++) {
      const tx = data.result[i];
      const hash = tx.hash;
      let feeStr = 'unknown';
      let status = 'pending';
      let timeIso: string | null = null;
      try {
        const receipt = await provider.getTransactionReceipt(hash);
        if (receipt && typeof receipt.status !== 'undefined') status = receipt.status === 1 ? 'confirmed' : 'failed';

        let gasPrice: BigNumber | undefined;
        if (receipt && (receipt as any).effectiveGasPrice) {
          gasPrice = BigNumber.from((receipt as any).effectiveGasPrice);
        } else {
          const txFull = await provider.getTransaction(hash);
          if (txFull && txFull.gasPrice) gasPrice = BigNumber.from(txFull.gasPrice as any);
        }

        if (receipt && receipt.gasUsed && gasPrice) {
          const fee = receipt.gasUsed.mul(gasPrice);
          feeStr = utils.formatEther(fee);
        }

        if (tx.timeStamp) timeIso = new Date(Number(tx.timeStamp) * 1000).toISOString();
        else if (tx.blockNumber) {
          const block = await provider.getBlock(tx.blockNumber);
          if (block && block.timestamp) timeIso = new Date(block.timestamp * 1000).toISOString();
        }
      } catch (e) {
        // ignore per-original behavior
      }

      let amountStr = '0';
      try {
        amountStr = utils.formatEther(BigNumber.from(tx.value ?? '0'));
      } catch (e) {
        amountStr = tx.value ?? '0';
      }
      const amountNum = Number(amountStr) || 0;
      const feeNum = feeStr && feeStr !== 'unknown' && !isNaN(Number(feeStr)) ? Number(feeStr) : 0;

      // balance for this transaction (balance after this tx) — start with newest = currentBalance
      const thisBalance = prevBalance;

      out.push({
        Signature: hash,
        time: timeIso,
        from: tx.from,
        to: tx.to,
        amount: amountNum,
        fee: feeNum || null,
        currency: 'ETH',
        status: tx.isError === '0' ? 'confirmed' : 'failed',
        balance: thisBalance,
      });

      // compute balance for the next (older) transaction by reversing this tx
      if (tx.from && tx.from.toLowerCase() === address.toLowerCase()) {
        // sent from our address: older balance = thisBalance + amount + fee
        prevBalance = thisBalance + amountNum + feeNum;
      } else if (tx.to && tx.to.toLowerCase() === address.toLowerCase()) {
        // received to our address: older balance = thisBalance - amount
        prevBalance = thisBalance - amountNum;
      } else {
        // unrelated tx: assume balance unchanged
        prevBalance = thisBalance;
      }
    }

    return out;
  }

  // Fallback to Alchemy if available
  const alchemy = rpc;
  if (alchemy) {
    const maxCount = 10000;
    const body: any = {
      jsonrpc: '2.0',
      id: 1,
      method: 'alchemy_getAssetTransfers',
      params: [{ fromBlock: '0x0', toBlock: 'latest', fromAddress: address, maxCount: maxCount, category: ['external', 'internal'] }],
    };
    const r = await fetch(alchemy, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({} as any));
    const transfers = j?.result?.transfers || [];
    // Sort transfers by blockTimestamp desc (newest first) to match Etherscan behavior
    const sorted = transfers
      .slice()
      .sort((a: any, b: any) => (b.metadata?.blockTimestamp ?? 0) - (a.metadata?.blockTimestamp ?? 0))
      .slice(0, maxCount);

    let prevBalanceA = currentBalanceNum;
    const outA: any[] = [];
    for (const t of sorted) {
      const raw = t.value ?? t.delta ?? '0';
      let amountStr = '0';
      try {
        amountStr = utils.formatEther(BigNumber.from(raw));
      } catch (e) {
        amountStr = raw;
      }
      const amountNum = Number(amountStr) || 0;

      const thisBalance = prevBalanceA;
      outA.push({
        Signature: t.hash || t.transactionHash,
        time: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp).toISOString() : null,
        from: t.from,
        to: t.to,
        amount: amountNum,
        fee: null,
        currency: 'ETH',
        status: 'unknown',
        balance: thisBalance,
      });

      if (t.from && t.from.toLowerCase() === address.toLowerCase()) {
        prevBalanceA = thisBalance + amountNum;
      } else if (t.to && t.to.toLowerCase() === address.toLowerCase()) {
        prevBalanceA = thisBalance - amountNum;
      } else {
        prevBalanceA = thisBalance;
      }
    }

    return outA;
  }

  return [];
}

