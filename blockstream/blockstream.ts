import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import readline from 'readline';

const ECPair = ECPairFactory(ecc);

// Blockstream API base (testnet)
const API_BASE = 'https://blockstream.info/testnet/api';

const DEFAULT_WALLET_FILE = 'wallet.json';

export type BTCWallet = {
  label?: string;
  address: string;
  PrivateKey: string;
  createdAt: string;
};

export async function prompt(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans: string = await new Promise((resolve) => rl.question(question, (a) => { resolve(a); rl.close(); }));
  return ans;
}

export function printHelp() {
  console.log(`Usage: npx ts-node blocklstream.ts <command> [args]\n
Commands:
  generate [outputPath]                Generate a new testnet wallet and save (default: wallet.json)
  balance <address?>                   Print address balance (satoshis) or saved wallet
  txs <address?> [limit]               Show recent transactions for address
  tx <txid> [--hex]                    Print transaction JSON or raw hex with --hex
  send <fromWif> <toAddress> <amount> [--feeRate=N]  Build, sign and broadcast a transaction
  help                                 Show this help
`);
}

function parseCliArgs() {
  const raw = process.argv.slice(2);
  const out: any = { cmd: 'help', args: [] };
  if (raw.length === 0) return out;
  out.cmd = raw[0];
  out.args = raw.slice(1);
  return out;
}

async function main() {
  const parsed = parseCliArgs();
  const cmd = parsed.cmd;
  const argv = parsed.args as string[];

  try {
    switch (cmd) {
      case 'generate': {
        const outPath = argv[0] || DEFAULT_WALLET_FILE;
        const label = argv[1] || 'btc-wallet';
        const count = Number(argv[2]) || 1;
        const wallets = generateWallet(count, label);
        saveWallets(wallets, outPath);
        if (wallets.length === 1) console.log('Address:', wallets[0].address);
        else wallets.forEach((w) => console.log('Address:', w.address));
      } break;
      case 'balance': {
        let address = argv[0];
        if (!address) {
          address = (await prompt('Address: ')).trim();
          if (!address) throw new Error('No address provided');
        }
        const bal = await queryBalance(address);
        console.log(JSON.stringify(bal, null, 2));
      } break;
      case 'txs': {
        let address = argv[0];
        if (!address) {
          address = (await prompt('Address: ')).trim();
          if (!address) throw new Error('No address provided');
        }
        const limit = Number(argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || Number(argv[1]) || 50;
        const result = await queryTransactions(address, limit);
        console.log(JSON.stringify(result, null, 2));
      } break;
      case 'tx': {
        const txid = argv[0];
        if (!txid) throw new Error('txid required');
        const wantHex = argv.includes('--hex');
        if (wantHex) {
          const hex = await queryTxHex(txid);
          console.log(hex);
        } else {
          const tx = await queryTx(txid);
          console.log(JSON.stringify(tx, null, 2));
        }
      } break;
      case 'send': {
        const fromArg = argv[0];
        const to = argv[1];
        const amount = argv[2];
        if (!to || !amount) throw new Error('Usage: send <from> <to> <amount> [--feeRate=N]');
        const feeRateArg = argv.find(a => a.startsWith('--feeRate='));
        const feeRate = feeRateArg ? Number(feeRateArg.split('=')[1]) : undefined;
        const privateKeyArg = argv.find(a => a.startsWith('--PrivateKey='));
        let privateKey = privateKeyArg ? privateKeyArg.split('=')[1] : undefined;
        // If the first arg is actually a WIF, accept it as the private key (non-interactive)
        if (!privateKey && fromArg) {
          try {
            const network = bitcoin.networks.testnet;
            ECPair.fromWIF(fromArg, network);
            privateKey = fromArg;
          } catch (e) {
            // not a WIF, continue to prompt
          }
        }
        if (!privateKey) privateKey = (await prompt('PrivateKey for sender (WIF): ')).trim();
        if (!privateKey) throw new Error('PrivateKey required for signing');
        const res = await sendTransaction(privateKey, to, amount, { feeRate });
        console.log(JSON.stringify(res, null, 2));
      } break;
      case 'help':
      default: printHelp(); break;
    }
  } catch (e: any) {
    console.error('Error:', e?.message ?? e);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export function generateWallet(count = 1, label = 'btc-wallet'): BTCWallet[] {
  const out: BTCWallet[] = [];
  const network = bitcoin.networks.testnet;
  for (let i = 0; i < count; i++) {
    const keyPair = ECPair.makeRandom({ network });
    const pubkeyBuffer = Buffer.from(keyPair.publicKey);
    const { address } = bitcoin.payments.p2wpkh({ pubkey: pubkeyBuffer, network }) || {};
    const fallback = bitcoin.payments.p2pkh({ pubkey: pubkeyBuffer, network }).address;
    const addr = address || fallback;
    if (!addr) throw new Error('Failed to derive address');
    const PrivateKey = keyPair.toWIF();
    const wallet: BTCWallet = { label: count > 1 ? `${label}-${i + 1}` : label, address: addr, PrivateKey, createdAt: new Date().toISOString() };
    // (BTCWallet type doesn't include label by default; we keep original shape but log label)
    out.push(wallet);
    console.log(`Generated ${addr}`);
  }
  return out;
}

export function saveWallets(wallets: BTCWallet[] | BTCWallet, outputPath = DEFAULT_WALLET_FILE) {
  const data = Array.isArray(wallets) ? { generated: wallets.length, wallets } : { generated: 1, wallets: [wallets] };
  const p = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Saved ${Array.isArray(wallets) ? wallets.length : 1} wallet(s) to ${p}`);
  return p;
}

async function queryAddressUtxos(address: string) {
  const url = `${API_BASE}/address/${address}/utxo`;
  const resp = await axios.get(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  return resp.data;
}

export async function queryBalance(address: string) {
  const utxos = await queryAddressUtxos(address);
  const sats = (utxos || []).reduce((acc: number, u: any) => acc + (u.value || 0), 0);
  const btc = Number(sats) / 1e8;
  return {
    address,
    network: 'testnet',
    balance: btc.toFixed(8),
    currency: 'BTC',
  } as const;
}

export async function queryTransactions(address: string, limit = 50): Promise<{ address: string; network: string; transaction: any[] }> {
  const url = `${API_BASE}/address/${address}/txs`;
  const resp = await axios.get(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  const txs = resp.data || [];

  const out = [] as any[];
  for (let i = 0; i < Math.min(txs.length, limit); i++) {
    const t: any = txs[i];
    const sig = t.txid || t.hash || null;
    const time = t.status && t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null;
    const status = t.status && t.status.confirmed ? 'confirmed' : 'pending';

    // Attempt to derive `from` address from first input
    let from: string | null = null;
    try {
      if (Array.isArray(t.vin) && t.vin.length) {
        const vin0 = t.vin[0];
        from = vin0.prevout?.scriptpubkey_address || vin0.prevout?.address || vin0.addr || null;
      }
    } catch (e) {
      from = null;
    }

    // Attempt to derive `to` address and amount (summing outs not equal to the queried address)
    let to: string | null = null;
    let amountStr = '0';
    try {
      if (Array.isArray(t.vout) && t.vout.length) {
        // sum outputs that are not the queried address (treat as outgoing to others)
        let sum = 0;
        for (const v of t.vout) {
          const addr = v.scriptpubkey_address || v.scriptpubkey || null;
          const val = Number(v.value ?? v.scriptpubkey_value ?? 0);
          if (!addr || addr.toLowerCase() !== address.toLowerCase()) {
            sum += Number(val || 0);
            if (!to) to = addr || null;
          }
        }
        // if sum is zero (all outputs to same address), take first vout
        if (sum === 0) {
          const v0 = t.vout[0];
          to = v0?.scriptpubkey_address || v0?.scriptpubkey || null;
          amountStr = ((Number(v0?.value ?? 0) / 1e8)).toString();
        } else {
          amountStr = ((Number(sum) / 1e8)).toString();
        }
      }
    } catch (e) {
      to = null;
    }

    // fee if present (satoshis -> btc)
    let feeStr: string | null = null;
    try {
      if (typeof t.fee !== 'undefined' && t.fee !== null) feeStr = (Number(t.fee) / 1e8).toString();
    } catch (e) {
      feeStr = null;
    }

    out.push({
      Signature: sig,
      time,
      from: (from || '').toLowerCase(),
      to: (to || '').toLowerCase(),
      amount: String(Number(amountStr)),
      fee: feeStr ?? '0',
      currency: 'BTC',
      status: status === 'confirmed' ? 'confirmed' : 'pending',
    });
  }

  return { address, network: 'testnet', transaction: out };
}

export async function queryTx(txid: string) {
  const url = `${API_BASE}/tx/${txid}`;
  const resp = await axios.get(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  return resp.data;
}

export async function queryTxHex(txid: string) {
  const url = `${API_BASE}/tx/${txid}/hex`;
  const resp = await axios.get(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  return resp.data;
}

export async function sendTransaction(senderWif: string, toAddress: string, amountArg: string, opts: { feeRate?: number } = {}) {
  const feeRate = opts.feeRate ?? 10;
  const amount = amountArg.includes('.') ? Math.floor(Number(amountArg) * 1e8) : Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount');

  const network = bitcoin.networks.testnet;
  if (!senderWif) throw new Error('WIF is required to sign the transaction');
  const keyPair = ECPair.fromWIF(senderWif, network);

  // derive sender address from WIF (use p2wpkh when possible)
  const pubkeyBuffer = Buffer.from(keyPair.publicKey);
  const derived = bitcoin.payments.p2wpkh({ pubkey: pubkeyBuffer, network }) || {};
  const fallback = bitcoin.payments.p2pkh({ pubkey: pubkeyBuffer, network }) || {};
  const fromAddress = (derived.address || fallback.address);
  if (!fromAddress) throw new Error('Failed to derive sender address from WIF');

  const utxos = await queryAddressUtxos(fromAddress);
  if (!Array.isArray(utxos) || utxos.length === 0) throw new Error('No UTXOs available');

  const preBalance = (utxos || []).reduce((acc: number, u: any) => acc + (u.value || 0), 0);

  const selected: any[] = [];
  let total = 0;
  for (const u of utxos) {
    selected.push(u);
    total += Number(u.value);
    const estFee = Math.ceil(((selected.length * 68) + (2 * 31) + 10) * feeRate);
    if (total >= amount + estFee) break;
  }
  const estFee = Math.ceil(((selected.length * 68) + (2 * 31) + 10) * feeRate);
  if (total < amount + estFee) throw new Error(`Insufficient funds: have ${total} need ${amount + estFee}`);

  const psbt = new bitcoin.Psbt({ network });

  for (const u of selected) {
    const prevTxHex = await queryTxHex(u.txid);
    const prevTx = bitcoin.Transaction.fromHex(prevTxHex);
    const prevOut = prevTx.outs[u.vout];
    psbt.addInput({
      hash: Buffer.from(u.txid, 'hex').reverse(),
      index: u.vout,
      witnessUtxo: { script: Buffer.from(prevOut.script), value: Number(u.value) },
    });
  }

  const change = total - amount - estFee;
  psbt.addOutput({ address: toAddress, value: amount });
  if (change > 546) psbt.addOutput({ address: fromAddress, value: change });

  const signer = {
    publicKey: Buffer.from(keyPair.publicKey),
    sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
  } as any;

  psbt.signAllInputs(signer);
  psbt.finalizeAllInputs();
  const raw = psbt.extractTransaction().toHex();

  const resp = await axios.post(`${API_BASE}/tx`, raw, { headers: { 'Content-Type': 'text/plain' } });
  const txid = typeof resp.data === 'string' ? resp.data : (resp.data?.txid || '<unknown>');

  // Try to fetch transaction details (time, fee, status) and updated balance
  try {
    const txInfo: any = await queryTx(txid);
    const time = txInfo?.status?.block_time ? new Date(txInfo.status.block_time * 1000).toISOString() : null;
    const fee = typeof txInfo?.fee !== 'undefined' && txInfo.fee !== null ? String(Number(txInfo.fee) / 1e8) : String(estFee / 1e8);
    const status = txInfo?.status?.confirmed ? 'confirmed' : 'pending';
    const newBalObj = await queryBalance(fromAddress);
    const senderBalance = Number(newBalObj.balance);

    return {
      Signature: txid,
      time,
      from: fromAddress,
      to: toAddress,
      amount: String(amount / 1e8),
      fee,
      currency: 'BTC',
      status,
      senderBalance,
    } as any;
  } catch (e) {
    // Fallback minimal response if detailed info not available
    try {
      const newBalObj = await queryBalance(fromAddress);
      return {
        Signature: txid,
        time: null,
        from: fromAddress,
        to: toAddress,
        amount: String(amount / 1e8),
        fee: String(estFee / 1e8),
        currency: 'BTC',
        status: 'pending',
        senderBalance: Number(newBalObj.balance),
      } as any;
    } catch (e2) {
      return {
        Signature: txid,
        time: null,
        from: fromAddress,
        to: toAddress,
        amount: String(amount / 1e8),
        fee: String(estFee / 1e8),
        currency: 'BTC',
        status: 'pending',
      } as any;
    }
  }
}
