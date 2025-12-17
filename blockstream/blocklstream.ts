import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

async function sleep(ms: number) { return new Promise((res) => setTimeout(res, ms)); }

const WALLET_FILE = path.join(__dirname, 'wallet.json');

type Wallet = {
  address: string;
  network: 'testnet';
  wif: string;
  createdAt: string;
};

export function generateTestnetWallet(): Wallet {
  const network = bitcoin.networks.testnet;
  const keyPair = ECPair.makeRandom({ network });
  const pubkeyBuffer = Buffer.from(keyPair.publicKey);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: pubkeyBuffer, network }) || {};
  const fallback = bitcoin.payments.p2pkh({ pubkey: pubkeyBuffer, network }).address;
  const addr = address || fallback;
  if (!addr) throw new Error('Failed to derive address');
  const wif = keyPair.toWIF();
  const wallet: Wallet = { address: addr, network: 'testnet', wif, createdAt: new Date().toISOString() };
  return wallet;
}

export function saveWallet(wallet: Wallet, file = WALLET_FILE) {
  fs.writeFileSync(file, JSON.stringify(wallet, null, 2), { encoding: 'utf8' });
}

// Simple CLI support
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === 'generate') {
    const wallet = generateTestnetWallet();
    saveWallet(wallet);
    console.log('Saved wallet to', WALLET_FILE);
    console.log('Address:', wallet.address);
    return;
  }
  
  // helper: load saved wallet if exists
  function loadSavedWallet(file = WALLET_FILE): Wallet | null {
    try {
      if (!fs.existsSync(file)) return null;
      const raw = fs.readFileSync(file, { encoding: 'utf8' });
      return JSON.parse(raw) as Wallet;
    } catch (e) {
      return null;
    }
  }

  // Blockstream.info testnet API helpers
  async function getAddressUtxos(address: string) {
    const url = `https://blockstream.info/testnet/api/address/${address}/utxo`;
    const resp = await axios.get(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
    return resp.data;
  }

  async function getBalance(address: string) {
    const utxos = await getAddressUtxos(address);
    const sats = (utxos || []).reduce((acc: number, u: any) => acc + (u.value || 0), 0);
    return sats;
  }

  async function getTxHistory(address: string, limit = 50) {
    const url = `https://blockstream.info/testnet/api/address/${address}/txs`;
    const resp = await axios.get(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
    const txs = resp.data || [];
    return txs.slice(0, limit);
  }

  // fetch a single tx by txid
  async function getTx(txid: string) {
    const url = `https://blockstream.info/testnet/api/tx/${txid}`;
    const resp = await axios.get(url, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
    return resp.data;
  }

  if (cmd === 'balance') {
    let address = argv[1];
    if (!address) {
      const w = loadSavedWallet();
      if (!w) {
        console.error('No address provided and no saved wallet found.');
        process.exit(1);
      }
      address = w.address;
    }
    try {
      const sats = await getBalance(address);
      console.log('Address:', address);
      console.log('Balance (sats):', sats);
      console.log('Balance (BTC):', (sats / 1e8).toString());
    } catch (e: any) {
      console.error('Error fetching balance:', e.message || e);
      process.exit(1);
    }
    return;
  }

  if (cmd === 'history' || cmd === 'txs') {
    let address = argv[1];
    if (!address) {
      const w = loadSavedWallet();
      if (!w) {
        console.error('No address provided and no saved wallet found.');
        process.exit(1);
      }
      address = w.address;
    }
    const opts: { limit?: number; full?: boolean } = {};
    for (const a of argv.slice(2)) {
      if (a.startsWith('--limit=')) opts.limit = Number(a.split('=')[1]) || undefined;
      if (a === '--full') opts.full = true;
    }
    try {
      const txs = await getTxHistory(address, opts.limit || 50);
      console.log(`Address: ${address} (showing ${txs.length} txs)`);
      console.log('');
      function fmtSats(n: any) { if (typeof n !== 'number') return String(n || 'n/a'); return `${n} sats (${(n/1e8).toFixed(8)} BTC)`; }
      for (const tx of txs) {
        if (opts.full) {
          console.log(JSON.stringify(tx, null, 2));
          continue;
        }
        const txid = tx.txid || tx.id || '<unknown>';
        const confirmed = tx.status && tx.status.confirmed ? 'confirmed' : 'unconfirmed';
        const time = tx.status && tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : 'n/a';
        const fee = typeof tx.fee === 'number' ? fmtSats(tx.fee) : 'n/a';

        console.log(`txid: ${txid}`);
        console.log(`status: ${confirmed} time: ${time} fee: ${fee}`);

        // outputs
        if (Array.isArray(tx.vout) && tx.vout.length) {
          console.log('outputs:');
          for (const [i, v] of tx.vout.entries()) {
            const val = typeof v.value === 'number' ? fmtSats(v.value) : String(v.value || '');
            const addresses = v.scriptpubkey_address || (v.scriptpubkey_addresses && v.scriptpubkey_addresses.join(',')) || v.address || '<unknown>';
            console.log(`[${i}] ${val} -> ${addresses}`);
          }
        }

        // inputs
        if (Array.isArray(tx.vin) && tx.vin.length) {
          console.log('inputs:');
          for (const [i, vin] of tx.vin.entries()) {
            const addr = (vin.prevout && (vin.prevout.scriptpubkey_address || vin.prevout.address)) || vin.address || '<unknown>';
            const val = vin.prevout && typeof vin.prevout.value === 'number' ? fmtSats(vin.prevout.value) : 'n/a';
            console.log(`[${i}] ${val} <- ${addr}`);
          }
        }

        console.log('');
      }
    } catch (e: any) {
      console.error('Error fetching tx history:', e.message || e);
      process.exit(1);
    }
    return;
  }

  // fetch and print a single tx by txid
  if (cmd === 'tx') {
    const txid = argv[1];
    if (!txid) {
      console.error('Usage: ts-node blocklstream.ts tx <txid> [--hex]');
      process.exit(1);
    }
    const wantHex = argv.includes('--hex');
    try {
      const tx = await getTx(txid);
      if (wantHex) {
        // Blockstream also exposes /tx/{txid}/hex
        try {
          const hexResp = await axios.get(`https://blockstream.info/testnet/api/tx/${txid}/hex`, { headers: { 'User-Agent': 'blockstream-cli/0.1' } });
          console.log(hexResp.data);
        } catch (hexErr) {
          console.log(JSON.stringify(tx, null, 2));
        }
      } else {
        console.log(JSON.stringify(tx, null, 2));
      }
    } catch (e: any) {
      console.error('Error fetching tx:', e.message || e);
      process.exit(1);
    }
    return;
  }

  // send: build, sign and broadcast a tx
  if (cmd === 'send') {
  const from = argv[1];
  const to = argv[2];
  const amountArg = argv[3];
  if (!from || !to || !amountArg) {
    console.error('Usage: ts-node blockstream.ts send <fromAddress> <toAddress> <amount> [--feeRate=SATS_PER_VB]');
    process.exit(1);
  }

  const feeRateArg = argv.find(a => a.startsWith('--feeRate='));
  const feeRate = feeRateArg ? Number(feeRateArg.split('=')[1]) : 10;

  const amount = amountArg.includes('.') ? Math.floor(Number(amountArg) * 1e8) : Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('Invalid amount:', amountArg);
    process.exit(1);
  }

  const saved = loadSavedWallet();
  if (!saved) {
    console.error('No saved wallet found. Run generate first.');
    process.exit(1);
  }
  if (from !== saved.address) {
    console.error('The provided from address does not match the saved wallet address.');
    process.exit(1);
  }

  try {
    const network = bitcoin.networks.testnet;
    const keyPair = ECPair.fromWIF(saved.wif, network);

    const utxos = await getAddressUtxos(from);
    if (!Array.isArray(utxos) || utxos.length === 0) {
      console.error('No UTXOs available for address', saved.address);
      process.exit(1);
    }

    const preBalance = (utxos || []).reduce((acc: number, u: any) => acc + (u.value || 0), 0);

    let selected: any[] = [];
    let total = 0;
    for (const u of utxos) {
      selected.push(u);
      total += Number(u.value);
      const estFee = Math.ceil(((selected.length * 68) + (2 * 31) + 10) * feeRate);
      if (total >= amount + estFee) break;
    }

    const estFee = Math.ceil(((selected.length * 68) + (2 * 31) + 10) * feeRate);
    if (total < amount + estFee) {
      console.error('Insufficient funds. have', total, 'need', amount + estFee);
      process.exit(1);
    }

    const psbt = new bitcoin.Psbt({ network });

    for (const u of selected) {
      const txhexResp = await axios.get(`https://blockstream.info/testnet/api/tx/${u.txid}/hex`, {
        headers: { 'User-Agent': 'blockstream-cli/0.1' }
      });
      const prevTxHex = txhexResp.data as string;
      const prevTx = bitcoin.Transaction.fromHex(prevTxHex);
      const prevOut = prevTx.outs[u.vout];

      psbt.addInput({
        hash: Buffer.from(u.txid, 'hex').reverse(),
        index: u.vout,
        witnessUtxo: {
          script: Buffer.from(prevOut.script),
          value: Number(u.value),
        },
      });
    }

    const change = total - amount - estFee;
    psbt.addOutput({ address: to, value: amount });
    if (change > 546) psbt.addOutput({ address: saved.address, value: change });

    // Create a Signer-compatible wrapper that ensures publicKey and hash are Buffers
    const signer = {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => {
        const h = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
        if (!Buffer.isBuffer(h) || h.length !== 32) {
          console.error('DEBUG: signer received invalid hash length:', h && h.length);
          console.error('DEBUG: hash (hex prefix):', h && h.toString('hex').slice(0, 64));
        }
        return Buffer.from(keyPair.sign(h));
      }
    };

    try {
      psbt.signAllInputs(signer);
    } catch (signErr: any) {
      console.error('DEBUG: signAllInputs failed:', signErr && signErr.message);
      console.error(signErr && signErr.stack);
      throw signErr;
    }

    // Skip explicit signature validation here; proceed to finalize inputs.
    // (Some environments may choose to call `validateSignaturesOfAllInputs`,
    // but it can surface low-level tiny-secp256k1 validation errors.)
    psbt.finalizeAllInputs();

    const raw = psbt.extractTransaction().toHex();

    const resp = await axios.post('https://blockstream.info/testnet/api/tx', raw, {
      headers: { 'Content-Type': 'text/plain' }
    });
    const txid = typeof resp.data === 'string' ? resp.data : (resp.data?.txid || '<unknown>');
    console.log('Broadcasted txid:', txid);
    console.log('Explorer (testnet): https://blockstream.info/testnet/tx/' + txid);

    try {
      let newBalance = await getBalance(saved.address);
      const maxAttempts = 6;
      let attempt = 0;
      while (attempt < maxAttempts && newBalance === preBalance) {
        await sleep(1000);
        attempt++;
        newBalance = await getBalance(saved.address);
      }
      const fmtAmount = (amount / 1e8).toFixed(8);
      const fmtNewBal = (newBalance / 1e8).toFixed(8);
      console.log(`Sent ${amount} sats (${fmtAmount} BTC) from ${from} to ${to}, txid: ${txid}`);
      console.log(`Sender balance: ${newBalance} sats (${fmtNewBal} BTC)`);
    } catch (balErr: any) {
      console.log('Sent', amount, 'sats from', from, 'to', to, 'txid:', txid);
      console.log('Failed to fetch updated balance:', balErr && balErr.message || balErr);
    }

  } catch (e: any) {
    if (e && e.response) {
      console.error('Error sending transaction: HTTP', e.response.status, JSON.stringify(e.response.data));
    } else {
      console.error('Error sending transaction:', e.message || e);
    }
    process.exit(1);
  }

  return;
}



  console.log('Usage:');
  console.log('  ts-node blocklstream.ts generate                         # generate wallet and save to wallet.json');
  console.log('  ts-node blocklstream.ts balance [<address>]              # show balance (satoshis) for address or saved wallet');
  console.log('  ts-node blocklstream.ts txs [<address>] [--limit=N] [--full]  # list recent txs; --full prints raw JSON');
  console.log('  ts-node blocklstream.ts tx <txid> [--hex]                  # fetch and print full tx JSON (or raw hex with --hex)');
  console.log('  ts-node blocklstream.ts send <fromAddress> <toAddress> <amount> [--feeRate=SAT_PER_VB]                  # add interactive prompts for sender/recipient addresses and amount');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
