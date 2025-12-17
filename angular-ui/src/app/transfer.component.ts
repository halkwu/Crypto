import { Component, Input } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ApiService } from './api.service';
import { Chain } from './models';

@Component({
  selector: 'app-transfer',
  template: `
    <div>
      <h3>转账 — {{chain}}</h3>
      <div *ngIf="!fromAccount">请选择发送账户（From）</div>
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div><label>To</label><input formControlName="to" /></div>
        <div><label>Amount</label><input formControlName="amount" /></div>
        <div *ngIf="chain!=='BTC'"><label>Fee / Gas</label><input formControlName="fee" /></div>
        <button type="submit" [disabled]="form.invalid">确认转账</button>
      </form>
      <div *ngIf="result">Result: {{result | json}}</div>
    </div>
  `
})
export class TransferComponent {
  @Input() chain!: Chain;
  @Input() fromAccount!: string;

  form = this.fb.group({ to: ['', Validators.required], amount: ['', Validators.required], fee: [''] });
  result: any = null;

  constructor(private fb: FormBuilder, private api: ApiService) {}

  onSubmit() {
    if (!this.fromAccount) return alert('Please provide from account');
    const payload = {
      chain: this.chain,
      fromAccount: this.fromAccount,
      to: this.form.value.to,
      amount: this.form.value.amount,
      fee: this.form.value.fee,
    };
    this.api.transfer(payload).subscribe({ next: (r) => this.result = r, error: (e) => this.result = e });
  }
}
