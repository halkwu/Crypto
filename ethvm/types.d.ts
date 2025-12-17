declare module 'api' {
  export interface RawTx {
    [key: string]: any;
  }
  export interface TxSummary {
    txHash: string;
    time: string | null;
    from?: string;
    to?: string;
    amount?: string;
    fee?: string | null;
    status?: string;
    raw?: RawTx;
  }

  export function fetchTransactions(address: string, limit?: number): Promise<TxSummary[]>;
}
