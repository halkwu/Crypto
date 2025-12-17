import { Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';

export async function fetchTransactions(address: string, limit = 10) {
  if (!address) throw new Error('address required');
  const conn = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const pub = new PublicKey(address);
  const sigs = await conn.getSignaturesForAddress(pub, { limit });
  const out: any[] = [];
  for (const s of sigs) {
    try {
      const parsed = await conn.getParsedTransaction(s.signature);
      out.push({
        txHash: s.signature,
        time: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
        status: s.err ? 'failed' : 'confirmed',
        raw: parsed || s
      });
    } catch (e) {
      out.push({ txHash: s.signature, time: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null, status: s.err ? 'failed' : 'confirmed' });
    }
  }
  return out;
}
