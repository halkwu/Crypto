import fs from 'fs';
import path from 'path';
import { Wallet, providers, utils } from 'ethers';

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
  txLimit: number;
}
interface SendConfig {
  fromPrivateKey?: string;
  toAddress?: string;
  amount?: string;
}

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

/**
 * =========================
 * Wallet Manager
 * =========================
 */

class EthereumWalletManager {
  private config: WalletConfig;
  private sendConfig?: SendConfig;
  private provider: providers.JsonRpcProvider;

  constructor(config: WalletConfig) {
    this.config = config;

    const rpc = process.env.ALCHEMY_SEPOLIA_RPC;
    if (!rpc) {
      throw new Error('Missing env ALCHEMY_SEPOLIA_RPC');
    }

    this.provider = new providers.JsonRpcProvider(rpc, 'sepolia');
  }

  setSendConfig(cfg: SendConfig) {
    this.sendConfig = cfg;
  }

  /**
   * Generate Sepolia wallets
   */
  async generateWallets(): Promise<WalletInfo[]> {
    const wallets: WalletInfo[] = [];

    for (let i = 0; i < this.config.count; i++) {
      const wallet = Wallet.createRandom();

      wallets.push({
        label: this.config.count > 1
          ? `${this.config.label}-${i + 1}`
          : this.config.label,
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic?.phrase ?? null,
        createdAt: new Date().toISOString(),
      });

      console.log(`[${i + 1}/${this.config.count}] ${wallet.address}`);
    }

    return wallets;
  }

  /**
   * Save wallets
   */
  saveWallets(wallets: WalletInfo[]): void {
    const output: WalletOutput = {
      generated: wallets.length,
      wallets,
    };

    const outputPath = path.resolve(process.cwd(), this.config.outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`\nSaved to ${outputPath}`);
  }

  /**
   * Query ETH balance (Sepolia)
   */
  async queryBalance(address: string): Promise<void> {
    const balance = await this.provider.getBalance(address);
    console.log(`\nAddress : ${address}`);
    console.log(`Network : Sepolia`);
    console.log(`Balance : ${utils.formatEther(balance)} ETH`);
  }

  /**
   * Query tx history (Sepolia via Etherscan)
   */
  async queryTransactions(address: string, limit: number): Promise<void> {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      throw new Error('Missing env ETHERSCAN_API_KEY');
    }

    // Use Etherscan v2 unified endpoint with chainid for Sepolia
    const url =
      `https://api.etherscan.io/v2/api` +
      `?chainid=11155111` +
      `&module=account&action=txlist` +
      `&address=${address}` +
      `&startblock=0&endblock=99999999` +
      `&page=1&offset=${limit}&sort=desc` +
      `&apikey=${apiKey}`;
      

    const res = await fetch(url);
    let data: any;
    const contentType = res.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        // not JSON (HTML or other) — capture body for diagnostics
        const text = await res.text();
        console.error('Etherscan returned non-JSON response:');
        console.error(text);
        throw new Error('Etherscan returned non-JSON response (see output)');
      }
    } catch (err) {
      // try to surface useful diagnostics if parse failed
      try {
        const text = await res.text();
        console.error('Failed to parse JSON from Etherscan. Response body:');
        console.error(text);
      } catch (e) {
        // ignore
      }
      // fall back to Alchemy if available
      const alchemyUrl = process.env.ALCHEMY_SEPOLIA_RPC;
      if (alchemyUrl) {
        console.log('Falling back to Alchemy RPC for transaction history...');
        try {
          const call = async (filter: any) => {
            const body = { jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [filter] };
            const r = await fetch(alchemyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const j = await r.json();
            return j.result?.transfers || [];
          };

          const out = await call({ fromBlock: '0x0', toBlock: 'latest', fromAddress: address, maxCount: limit, category: ['external', 'internal'] });
          const inc = await call({ fromBlock: '0x0', toBlock: 'latest', toAddress: address, maxCount: limit, category: ['external', 'internal'] });
          const combined = [...out, ...inc];
          if (combined.length === 0) {
            console.log('No transactions found (Alchemy).');
            return;
          }

          // normalize to etherscan-like fields for printing
          combined.slice(0, limit).forEach((tx: any, i: number) => {
            const value = tx.value || tx.delta || '0';
            const hash = tx.hash || tx.transactionHash || tx.id;
            const block = tx.blockNum || tx.blockNumber || tx.blockHash || 'unknown';
            console.log(`${i + 1}. hash=${hash} from=${tx.from} to=${tx.to} value=${utils.formatEther(value.toString())} ETH block=${block}`);
          });

          return;
        } catch (e) {
          console.error('Alchemy fallback failed:', e instanceof Error ? e.message : e);
        }
      }
      throw err;
    }

    console.log(`\nAddress : ${address}`);
    console.log(`Network : Sepolia`);

    if (data.status !== '1') {
      console.log('No transactions found.');
      return;
    }

    data.result.slice(0, limit).forEach((tx: any, i: number) => {
      console.log(
        `${i + 1}. ${tx.hash} | ${utils.formatEther(tx.value)} ETH | block ${tx.blockNumber}`
      );
    });
  }

  /**
   * Send ETH from a private key to a recipient address
   */
  async sendTransaction(fromPrivateKey: string, to: string, amountEther = '0.001'): Promise<string> {
    const apiKey = process.env.ETHERSCAN_API_KEY || 'CYR4YTW1WY82EW6VJUCQMB2V6U9ERUAEA6';
    const provider = apiKey
      ? providers.getDefaultProvider(this.config.network || 'Sepolia', { etherscan: apiKey })
      : providers.getDefaultProvider(this.config.network || 'Sepolia');

    const sender = new Wallet(fromPrivateKey, provider);
    console.log(`Sending ${amountEther} ETH from ${sender.address} to ${to} on ${this.config.network}`);
    const tx = await sender.sendTransaction({ to, value: utils.parseEther(amountEther) });
    console.log(`Transaction submitted: ${tx.hash}`);
    try {
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    } catch (err) {
      console.warn(`Error waiting for confirmation: ${err instanceof Error ? err.message : err}`);
    }
    return tx.hash;
  }

  /**
   * Run
   */
  async run(): Promise<void> {
    if (this.config.mode === 'generate') {
      const wallets = await this.generateWallets();
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
      await this.queryBalance(this.config.address);
      return;
    }

    if (this.config.mode === 'txs') {
      if (!this.config.address) {
        throw new Error('Address is required for txs mode.');
      }
      await this.queryTransactions(this.config.address, this.config.txLimit);
    }

    if (this.config.mode === 'send') {
      // determine from/to/amount
      const send = this.sendConfig || ({} as SendConfig);
      const fromKey = (send as any).fromPrivateKey as string | undefined;
      const toAddr = send.toAddress;
      const amount = send.amount || '0.001';

      if (!fromKey) {
        throw new Error('Missing sender private key: provide --from-key <privateKey>');
      }
      if (!toAddr) {
        throw new Error('Missing recipient address: provide --to <address>');
      }

      await this.sendTransaction(fromKey, toAddr, amount);
      return;
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
    txLimit: 10,
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
      case '-L':
      case '--limit':
        config.txLimit = Number(raw[++i]) || 10;
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
  ts-node ethvm.ts txs -a 0xabc... -L 5
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

main();

