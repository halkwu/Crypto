import fs from 'fs';
import path from 'path';
import { Wallet, providers, utils, BigNumber } from 'ethers';
import * as readline from 'readline';

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

/**
 * =========================
 * Wallet Manager
 * =========================
 */

class EthereumWalletManager {
  private config: WalletConfig;
  private sendConfig?: SendConfig;

  constructor(config: WalletConfig) {
    this.config = config;
    const rpc = process.env.ALCHEMY_SEPOLIA_RPC;
    if (!rpc) {
      throw new Error('Missing env ALCHEMY_SEPOLIA_RPC');
    }
  }

  setSendConfig(cfg: SendConfig) {
    this.sendConfig = cfg;
  }
  /**
   * Save wallets
   */
  saveWallets(wallets: WalletInfo[]): void {
    saveWallets(wallets, this.config.outputPath);
}
  /**
   * Run
   */
  async run(): Promise<any> {
    if (this.config.mode === 'generate') {
      const wallets = await generateWallets(this.config.count, this.config.label);
      this.saveWallets(wallets);
      return;
    }

    if (this.config.mode !== 'send' && !this.config.address) {
      throw new Error('Address is required.');
    }

    if (this.config.mode === 'balance') {
      if (!this.config.address) {
        throw new Error('Address is required for balance mode.');
      }
      const info = await queryBalance(this.config.address);
      // When used internally or by the REST API, only output the function return
      console.log(JSON.stringify(info, null, 2));
      return info;
    }

    if (this.config.mode === 'txs') {
      if (!this.config.address) {
        throw new Error('Address is required for txs mode.');
      }
      // use exported helper to get txs and return a single JSON object
      const transaction = await queryTransactions(this.config.address);
      const result = { address: this.config.address, network: 'Sepolia', transaction: transaction };
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    if (this.config.mode === 'send') {
      // determine from/to/amount
      const send = this.sendConfig || ({} as SendConfig);
      const fromKey = (send as any).fromPrivateKey as string | undefined;
      const toAddr = send.toAddress;
      let amount = send.amount;

      if (!fromKey) {
        throw new Error('Missing sender private key: provide --from-key <privateKey>');
      }
      if (!toAddr) {
        throw new Error('Missing recipient address: provide --to <address>');
      }

      // If running interactively and amount not provided, prompt the user until provided
      if ((!amount || String(amount).trim() === '') && process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        amount = await new Promise<string>((resolve) => {
          const ask = () => {
            rl.question('Amount (ETH) to send: ', (ans) => {
              const v = ans && ans.trim();
              if (v) {
                rl.close();
                resolve(v);
              } else {
                console.log('Amount is required.');
                ask();
              }
            });
          };
          ask();
        });
      }

      if (!amount || String(amount).trim() === '') throw new Error('Missing amount: provide --amount <eth>');

      const result = await sendTransaction(fromKey, toAddr, String(amount), this.config.network);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
  }
}

/**
 * =========================
 * CLI
 * =========================
 */

function parseCliArgs(): WalletConfig {
  const raw = process.argv.slice(2);

  const config: WalletConfig = {
    mode: 'generate',
    outputPath: 'wallet.json',
    count: 1,
    label: 'sepolia-wallet',
    network: 'sepolia',
  };

  if (raw.length && !raw[0].startsWith('-')) {
    config.mode = raw.shift() as WalletConfig['mode'];
  }

  const sendConfig: SendConfig = {};

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];

    switch (arg) {
      case '-c':
      case '--count':
        config.count = Number(raw[++i]) || 1;
        break;
      case '-o':
      case '--out':
        config.outputPath = raw[++i];
        break;
      case '-l':
      case '--label':
        config.label = raw[++i];
        break;
      case '-a':
      case '--address':
        config.address = raw[++i];
        break;      
      case '--from-key':
        // backward-compatible flag
        (sendConfig as any).fromPrivateKey = raw[++i];
        break;
      case '--to':
        sendConfig.toAddress = raw[++i];
        break;
      case '--amount':
        sendConfig.amount = raw[++i];
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  // attach sendConfig for main to pick up
  (config as any).__send = sendConfig;

  return config;
}

function printHelp(): void {
  console.log(`
EthVM Sepolia Wallet Tool

Commands:
  generate
  balance -a <address>
  txs -a <address>
  send --from-key <privateKey> --to <address> [--amount <eth>]

Examples:
  ts-node ethvm.ts generate -c 2
  ts-node ethvm.ts balance -a 0xabc...
  ts-node ethvm.ts txs -a 0xabc...
  ts-node ethvm.ts send --from-key 0xPRIVATEKEY --to 0xRECIPIENT --amount 0.01

Env:
  ALCHEMY_SEPOLIA_RPC
  ETHERSCAN_API_KEY
`);
}

/**
 * =========================
 * Main
 * =========================
 */

async function main() {
  try {
    const config = parseCliArgs();
    const manager = new EthereumWalletManager(config);
    const sendCfg = (config as any).__send as SendConfig | undefined;
    if (sendCfg) manager.setSendConfig(sendCfg);
    await manager.run();
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// Only run CLI main when this file is executed directly, not when imported.
if (typeof require !== 'undefined' && require.main === module) {
  main();
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
    console.log(`[${i + 1}/${count}] ${w.address}`);
  }
  return wallets;
}

// Exported helper to save wallets to disk
export function saveWallets(wallets: WalletInfo[], outputPath = 'wallet.json'): void {
  const output: WalletOutput = { generated: wallets.length, wallets };
  const p = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(p, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nSaved to ${p}`);
}

// Exported reusable sendTransaction for external use (returns hash and optional receipt)
export interface SendResult {
  Signature: string;
  time: string | null;
  from: string;
  to: string;
  amount: number | string;
  fee: number | string;
  currency: string;
  status: 'pending' | 'confirmed' | 'failed' | 'unknown';
  senderBalance?: number | string;
}

export async function sendTransaction(fromPrivateKey: string, to: string, amount: string, network = 'sepolia'): Promise<SendResult> {
  if (!amount || String(amount).trim() === '') throw new Error('amount is required');
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
  let senderBalanceStr: string | null = null;
  try {
    const bal = await provider.getBalance(sender.address);
    senderBalanceStr = utils.formatEther(bal);
  } catch (e) {
    senderBalanceStr = null;
  }

  const result: SendResult = {
    Signature: tx.hash,
    time: timeIso,
    from: sender.address,
    to,
    amount: (() => {
      const n = Number(amtStr);
      return Number.isFinite(n) ? n : amtStr;
    })(),
    fee: feeStr ? Number(feeStr) : 'unknown',
    currency: 'ETH',
    status,
    senderBalance: senderBalanceStr ? Number(senderBalanceStr) : 'unknown',
  };

  return result;
}

// Reusable helper for other modules (REST API) to get formatted balance
export async function queryBalance(address: string): Promise<{ address: string; network: string; balance: string;  currency: string; }> {
  const rpc = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_RPC || process.env.ALCHEMY_MAINNET_RPC;
  const provider = rpc ? new providers.JsonRpcProvider(rpc, 'sepolia') : providers.getDefaultProvider('sepolia', { etherscan: process.env.ETHERSCAN_API_KEY });
  const balance = await provider.getBalance(address);
  const formatted = utils.formatEther(balance);
  return { address, network: 'Sepolia', balance: `${formatted}`, currency: 'ETH' };
}

// Reusable transaction query for other modules
export async function queryTransactions(address: string): Promise<any[]> {
  if (!address) throw new Error('address required');

  const apiKey = process.env.ETHERSCAN_API_KEY;
  const rpc = process.env.ALCHEMY_SEPOLIA_RPC || process.env.ALCHEMY_RPC || process.env.ALCHEMY_MAINNET_RPC;
  const provider = rpc ? new providers.JsonRpcProvider(rpc, 'sepolia') : providers.getDefaultProvider('sepolia', { etherscan: apiKey });

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

      out.push({
        Signature: hash,
        time: timeIso,
        from: tx.from,
        to: tx.to,
        amount: amountStr,
        fee: feeStr,
        currency: 'ETH',
        status: tx.isError === '0' ? 'confirmed' : 'failed',
      });
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
    return transfers.slice(0, maxCount).map((t: any) => {
      const raw = t.value ?? t.delta ?? '0';
      let amountStr = '0';
      try {
        amountStr = utils.formatEther(BigNumber.from(raw));
      } catch (e) {
        amountStr = raw;
      }
      return {
        Signature: t.hash || t.transactionHash,
        time: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp).toISOString() : null,
        from: t.from,
        to: t.to,
        amount: amountStr,
        fee: 'unknown',
        currency: 'ETH',
        status: 'unknown',
      };
    });
  }

  return [];
}

