import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Chain, TxItem, TransferRequest } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  base = '/api/v1';
  constructor(private http: HttpClient) {}

  // Unified tx history endpoint: accepts chain as query param
  getTxs(chain: Chain, account: string, limit = 20): Observable<TxItem[]> {
    const params = new HttpParams()
      .set('chain', chain)
      .set('account', account)
      .set('limit', String(limit));
    return this.http.get<TxItem[]>(`${this.base}/txs`, { params });
  }

  // Unified transfer endpoint: chain in body
  transfer(req: TransferRequest): Observable<any> {
    return this.http.post(`${this.base}/transfer`, req);
  }
}
