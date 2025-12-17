import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { ApiService } from './api.service';
import { Chain, TxItem } from './models';

@Component({
  selector: 'app-history',
  template: `
    <div>
      <h3>交易历史 — {{chain}}</h3>
      <div *ngIf="!account">请输入账户地址以查询</div>
      <table *ngIf="account">
        <thead><tr><th>时间</th><th>TxHash</th><th>金额</th><th>状态</th></tr></thead>
        <tbody>
          <tr *ngFor="let tx of txs">
            <td>{{tx.time}}</td>
            <td>{{tx.txHash}}</td>
            <td>{{tx.amount}}</td>
            <td>{{tx.status}}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `
})
export class HistoryComponent implements OnChanges {
  @Input() chain!: Chain;
  @Input() account!: string;

  txs: TxItem[] = [];

  constructor(private api: ApiService) {}

  ngOnChanges(changes: SimpleChanges) {
    if ((changes.chain || changes.account) && this.account) {
      this.reload();
    }
  }

  reload() {
    this.api.getTxs(this.chain, this.account, 50).subscribe({ next: (d) => this.txs = d, error: () => this.txs = [] });
  }
}
