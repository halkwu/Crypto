import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

// Blockstream API base (testnet)
const API_BASE = 'https://blockstream.info/testnet/api';

const DEFAULT_WALLET_FILE = 'wallet.json';

// Basic bitcoin testnet address validation helper
export function isValidAddress(address: string) {
  if (!address || typeof address !== 'string') return false;
  try {
    // bitcoinjs-lib will throw on unsupported/invalid address formats for the network
    bitcoin.address.toOutputScript(address, bitcoin.networks.testnet);
    return true;
  } catch (e) {
    return false;
  }
}

export type BTCWallet = {
  label?: string;
  address: string;
  PrivateKey: string;
  createdAt: string;
};

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
  const arr = Array.isArray(wallets) ? wallets : [wallets];
  const data = { generated: arr.length, wallets: arr };
  const p = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Saved ${arr.length} wallet(s) to ${p}`);
  return p;
}

async function queryAddressUtxos(address: string): Promise<any[]> {
  const url = `${API_BASE}/address/${address}/utxo`;
  const resp = await axios.get<any[]>(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  return resp.data as any[];
}

export async function queryBalance(address: string) {
  if (!isValidAddress(address)) throw new Error('invalid address format');
  const utxos = await queryAddressUtxos(address);
  const sats = (utxos || []).reduce((acc: number, u: any) => acc + (u.value || 0), 0);
  const btc = Number(sats) / 1e8;
  const balance = Number(btc.toFixed(8));
  return {
    address,
    network: 'testnet',
    balance,
    currency: 'BTC',
  } as const;
}

export async function queryTransactions(address: string, limit = 10000): Promise<{ address: string; network: string; transaction: any[] }> {
  if (!isValidAddress(address)) throw new Error('invalid address format');
  const url = `${API_BASE}/address/${address}/txs`;
  const resp = await axios.get<any[]>(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  const txs = resp.data || [];

  // get current balance (BTC) to use as balance for newest tx
  const balInfo = await queryBalance(address);
  let currentBalanceNum = 0;
  try { currentBalanceNum = Number(balInfo.balance) || 0; } catch (e) { currentBalanceNum = 0; }

  const out = [] as any[];
  // assume API returns newest first; treat index 0 as newest
  let prevBalance = currentBalanceNum;
  for (let i = 0; i < Math.min(txs.length, limit); i++) {
    const t: any = txs[i];
    const sig = t.txid || t.hash || null;
    const time = t.status && t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null;
    const status = t.status && t.status.confirmed ? 'confirmed' : 'pending';

    // Infer from/to/amount based on vin.prevout and vout
    let from: string | null = null;
    let to: string | null = null;
    let amountNum = 0; // in BTC
    try {
      const vins = Array.isArray(t.vin) ? t.vin : [];
      const vouts = Array.isArray(t.vout) ? t.vout : [];

      // collect prevout addresses from inputs
      const prevoutAddrs = vins.map((v: any) => (v.prevout?.scriptpubkey_address || v.prevout?.address || v.addr || null)).filter(Boolean).map((a: string) => a.toLowerCase());

      const allInputsAreUs = prevoutAddrs.length > 0 && prevoutAddrs.every((a: string) => a === address.toLowerCase());

      // helper to pick the other address in vouts (first address not equal to queried)
      const otherOutAddr = (() => {
        for (const v of vouts) {
          const a = v.scriptpubkey_address || v.scriptpubkey || null;
          if (a && a.toLowerCase() !== address.toLowerCase()) return a;
        }
        return null;
      })();

      if (allInputsAreUs) {
        // outgoing: we sent funds — from = address, to = other out address, amount = sum of vouts not to us
        from = address.toLowerCase();
        let sumOut = 0;
        for (const v of vouts) {
          const a = v.scriptpubkey_address || v.scriptpubkey || null;
          const val = Number(v.value ?? v.scriptpubkey_value ?? 0);
          if (!a || a.toLowerCase() !== address.toLowerCase()) {
            sumOut += Number(val || 0);
            if (!to) to = a || null;
          }
        }
        // if no other outs found, take first out as recipient
        if (!to && vouts.length) {
          const v0 = vouts[0];
          to = v0?.scriptpubkey_address || v0?.scriptpubkey || null;
          sumOut = Number(v0?.value ?? 0);
        }
        amountNum = (Number(sumOut) / 1e8) || 0;
      } else {
        // incoming (not all inputs are ours): treat as to = address, amount = sum of vouts to us, from = other out address if present
        to = address.toLowerCase();
        let sumToUs = 0;
        for (const v of vouts) {
          const a = v.scriptpubkey_address || v.scriptpubkey || null;
          const val = Number(v.value ?? v.scriptpubkey_value ?? 0);
          if (a && a.toLowerCase() === address.toLowerCase()) {
            sumToUs += Number(val || 0);
          } else {
            if (!from) from = a || null;
          }
        }
        // fallback: if no matching vout found, attempt to use first vout value
        if (sumToUs === 0 && vouts.length) {
          const v0 = vouts[0];
          const a0 = v0?.scriptpubkey_address || v0?.scriptpubkey || null;
          if (a0 && a0.toLowerCase() === address.toLowerCase()) sumToUs = Number(v0?.value ?? 0);
        }
        amountNum = (Number(sumToUs) / 1e8) || 0;
        // if from still null, try to infer from first input prevout
        if (!from && prevoutAddrs.length) from = prevoutAddrs[0] || null;
      }
    } catch (e) {
      from = null; to = null; amountNum = 0;
    }

    // fee if present (satoshis -> btc)
    let feeNum: number = 0;
    try {
      if (typeof t.fee !== 'undefined' && t.fee !== null) feeNum = Number(t.fee) / 1e8;
    } catch (e) {
      feeNum = 0;
    }

    // balance for this transaction (balance after this tx) — currentBalance for newest
    const thisBalance = prevBalance;

    out.push({
      Signature: sig,
      time,
      from: (from || '').toLowerCase(),
      to: (to || '').toLowerCase(),
      amount: Number(amountNum),
      fee: feeNum || 0,
      currency: 'BTC',
      status: status === 'confirmed' ? 'confirmed' : 'pending',
      balance: Number(thisBalance.toFixed(8)),
    });

    // compute previous (older) balance by reversing this tx
    try {
      if (from && from.toLowerCase() === address.toLowerCase()) {
        // we sent: older balance = thisBalance + amount + fee
        prevBalance = thisBalance + (Number(amountNum) || 0) + (feeNum || 0);
      } else if (to && to.toLowerCase() === address.toLowerCase()) {
        // we received: older balance = thisBalance - amount
        prevBalance = thisBalance - (Number(amountNum) || 0);
      } else {
        prevBalance = thisBalance;
      }
    } catch (e) {
      prevBalance = thisBalance;
    }
  }

  return { address, network: 'testnet', transaction: out };
}

async function queryTx(txid: string) {
  const url = `${API_BASE}/tx/${txid}`;
  const resp = await axios.get<any>(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  return resp.data;
}

async function queryTxHex(txid: string): Promise<string> {
  const url = `${API_BASE}/tx/${txid}/hex`;
  const resp = await axios.get<string>(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
  return String(resp.data);
}

export async function sendTransaction(senderWif: string, toAddress: string, amountArg: string, opts: { feeRate?: number } = {}) {
  const feeRate = opts.feeRate ?? 10;
  const amount = amountArg.includes('.') ? Math.floor(Number(amountArg) * 1e8) : Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount');

  const network = bitcoin.networks.testnet;
  if (!senderWif) throw new Error('WIF is required to sign the transaction');
  const keyPair = ECPair.fromWIF(senderWif, network);

  // validate recipient address early
  if (!isValidAddress(toAddress)) throw new Error('invalid recipient address format');

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

  const resp = await axios.post<any>(`${API_BASE}/tx`, raw, { headers: { 'Content-Type': 'text/plain' } });
  const txid = typeof resp.data === 'string' ? resp.data : (resp.data?.txid || '<unknown>');

  // Try to fetch transaction details (time, fee, status) and updated balance
  try {
    const txInfo: any = await queryTx(txid);
    const time = txInfo?.status?.block_time ? new Date(txInfo.status.block_time * 1000).toISOString() : null;
    const feeNum = typeof txInfo?.fee !== 'undefined' && txInfo.fee !== null ? Number(txInfo.fee) / 1e8 : estFee / 1e8;
    const status = txInfo?.status?.confirmed ? 'confirmed' : 'pending';
    const actualFeeSats = (typeof txInfo?.fee !== 'undefined' && txInfo.fee !== null) ? Number(txInfo.fee) : estFee;
    const balance = Number((Math.max(0, (preBalance - amount - actualFeeSats) / 1e8)).toFixed(8));

    return {
      Signature: txid,
      time,
      from: fromAddress,
      to: toAddress,
      amount: amount / 1e8,
      fee: feeNum,
      currency: 'BTC',
      status,
      balance,
    } as any;
  } catch (e) {
    // Fallback minimal response if detailed info not available
      try {
        await queryBalance(fromAddress);
        const balance = Number((Math.max(0, (preBalance - amount - estFee) / 1e8)).toFixed(8));
        return {
          Signature: txid,
          time: null,
          from: fromAddress,
          to: toAddress,
          amount: amount / 1e8,
          fee: estFee / 1e8,
          currency: 'BTC',
          status: 'pending',
          balance,
        } as any;
      } catch (e2) {
        const balance = Number((Math.max(0, (preBalance - amount - estFee) / 1e8)).toFixed(8));
        return {
          Signature: txid,
          time: null,
          from: fromAddress,
          to: toAddress,
          amount: amount / 1e8,
          fee: estFee / 1e8,
          currency: 'BTC',
          status: 'pending',
          balance,
        } as any;
      }
  }
}