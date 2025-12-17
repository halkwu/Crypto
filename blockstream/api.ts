import axios from 'axios';

export async function fetchTransactions(address: string, limit = 50) {
  if (!address) throw new Error('address required');
  const url = `https://blockstream.info/testnet/api/address/${address}/txs`;
  const resp = await axios.get(url, { headers: { 'User-Agent': 'unified-api/0.1' } });
  const txs = (resp.data || []).slice(0, limit).map((tx: any) => ({
    txHash: tx.txid || tx.id,
    time: tx.status && tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : null,
    status: tx.status && tx.status.confirmed ? 'confirmed' : 'unconfirmed',
    fee: tx.fee,
    raw: tx
  }));
  return txs;
}
