import fs from 'fs';
import path from 'path';
import { Wallet, providers, utils, BigNumber } from 'ethers';

/**
 * =========================
 * Config & Types
 * =========================
 */

interface WalletInfo {
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

interface SendResult {
  transactionId: string;
  transactionTime: string | null;
  amount: number;
  currency: string;
  description: string;
  status: 'pending' | 'confirmed' | 'failed' | 'unknown';
  balance?: number | null;
}

// Basic Ethereum address validation helper
export function isValidAddress(address: string | undefined | null) {
  if (!address || typeof address !== 'string') return false;
  try {
    return utils.isAddress(address);
  } catch (e) {
    return false;
  }
}

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
    transactionId: tx.hash,
    transactionTime: timeIso,
    amount: (() => {
      const n = Number(amtStr);
      return Number.isFinite(n) ? n : parseFloat(amtStr) || 0;
    })(),
    currency: 'ETH',
    description: `from:${(tx.from || '')} to:${(tx.to || '')} fee:${String(feeStr || 0)}`,
    status,
    balance: balanceStr && !isNaN(Number(balanceStr)) ? Number(balanceStr) : null,
  };

  return result;
}

// Reusable helper for other modules (REST API) to get formatted balance
export async function queryBalance(id: string): Promise<{ id: string; name: string; balance: string;  currency: string; }> {
  if (!isValidAddress(id)) throw new Error('invalid address format');
  const rpc = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_RPC || process.env.ALCHEMY_MAINNET_RPC;
  const provider = rpc ? new providers.JsonRpcProvider(rpc, 'sepolia') : providers.getDefaultProvider('sepolia', { etherscan: process.env.ETHERSCAN_API_KEY });
  const balance = await provider.getBalance(id);
  const formatted = utils.formatEther(balance);
  return { id: id, name: 'Sepolia', balance: Number(formatted), currency: 'ETH' } as any;
}

// Reusable transaction query for other modules
export async function queryTransactions(id: string): Promise<any[]> {
  if (!id) throw new Error('address required');
  if (!isValidAddress(id)) throw new Error('invalid address format');

  const apiKey = process.env.ETHERSCAN_API_KEY;
  const rpc = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_RPC || process.env.ALCHEMY_MAINNET_RPC;
  const provider = rpc ? new providers.JsonRpcProvider(rpc, 'sepolia') : providers.getDefaultProvider('sepolia', { etherscan: apiKey });

  // Get current account balance (used as the balance after the newest tx)
  let currentBalanceNum = 0;
  try {
    const bal = await provider.getBalance(id);
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
      `&address=${id}` +
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
      const sig = tx.hash;
      let feeStr = 'unknown';
      let status = 'pending';
      let time: string | null = null;
      try {
        const receipt = await provider.getTransactionReceipt(sig);
        if (receipt && typeof receipt.status !== 'undefined') status = receipt.status === 1 ? 'confirmed' : 'failed';

        let gasPrice: BigNumber | undefined;
        if (receipt && (receipt as any).effectiveGasPrice) {
          gasPrice = BigNumber.from((receipt as any).effectiveGasPrice);
        } else {
          const txFull = await provider.getTransaction(sig);
          if (txFull && txFull.gasPrice) gasPrice = BigNumber.from(txFull.gasPrice as any);
        }

        if (receipt && receipt.gasUsed && gasPrice) {
          const fee = receipt.gasUsed.mul(gasPrice);
          feeStr = utils.formatEther(fee);
        }

        if (tx.timeStamp) time = new Date(Number(tx.timeStamp) * 1000).toISOString();
        else if (tx.blockNumber) {
          const block = await provider.getBlock(tx.blockNumber);
          if (block && block.timestamp) time = new Date(block.timestamp * 1000).toISOString();
        }
      } catch (e) {
        console.warn(`Error fetching receipt for tx ${sig}: ${e instanceof Error ? e.message : e}`);
      }

      let amountStr = '0';
      try {
        amountStr = utils.formatEther(BigNumber.from(tx.value ?? '0'));
      } catch (e) {
        amountStr = tx.value ?? '0';
      }

      const amountNum = Number(amountStr) || 0;
      const feeNum = feeStr && feeStr !== 'unknown' && !isNaN(Number(feeStr)) ? Number(feeStr) : 0;
      const thisBalance = prevBalance;

      out.push({
        transactionId: sig,
        transactionTime: time,
        amount: amountNum,
        currency: 'ETH',
        description: `from:${(tx.from || '')} to:${(tx.to || '')} fee:${String(feeNum || 0)}`,
        status: tx.isError === '0' ? 'confirmed' : 'failed',
        balance: Number(thisBalance.toFixed(8)),
      });

      // compute balance for the next (older) transaction by reversing this tx
      if (tx.from && tx.from === id) {
        // sent from our address: older balance = thisBalance + amount + fee
        prevBalance = thisBalance + amountNum + feeNum;
      } else if (tx.to && tx.to === id) {
        // received to our address: older balance = thisBalance - amount
        prevBalance = thisBalance - amountNum;
      } else {
        // unrelated tx: assume balance unchanged
        prevBalance = thisBalance;
      }
    }

    return out;
  }
}