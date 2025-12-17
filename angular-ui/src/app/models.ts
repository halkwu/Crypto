export type Chain = 'BTC' | 'ETH' | 'SOL';

export interface TxItem {
  time: string; // ISO
  txHash: string;
  amount: string;
  status: 'success' | 'failed' | 'pending';
}

export interface TransferRequest {
  chain: Chain;
  fromAccount: string;
  to: string;
  amount: string;
  fee?: string;
}
