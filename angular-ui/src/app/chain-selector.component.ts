import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Chain } from './models';

@Component({
  selector: 'app-chain-selector',
  template: `
    <div class="selector">
      <label>Chain / Account:</label>
      <select [value]="selectedChain" (change)="onChainSelect($event)">
        <option value="BTC">BTC</option>
        <option value="ETH">ETH</option>
        <option value="SOL">SOL</option>
      </select>

      <input placeholder="Account / address" [(ngModel)]="localAccount" (blur)="emitAccount()" />
    </div>
  `,
  styles: [`.selector { display:flex; gap:8px; align-items:center; } input{flex:1}`]
})
export class ChainSelectorComponent {
  @Input() selectedChain: Chain = 'BTC';
  @Output() chainChange = new EventEmitter<Chain>();
  @Output() accountChange = new EventEmitter<string>();

  localAccount = '';

  onChainSelect(e: any) {
    const val = e.target.value as Chain;
    this.chainChange.emit(val);
  }

  emitAccount() {
    this.accountChange.emit(this.localAccount);
  }
}
