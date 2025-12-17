import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-feature-tabs',
  template: `
    <div class="tabs">
      <button [class.active]="selectedFeature==='history'" (click)="set('history')">交易历史</button>
      <button [class.active]="selectedFeature==='transfer'" (click)="set('transfer')">转账</button>
    </div>
  `,
  styles: [`.tabs { display:flex; gap:8px; } button{padding:8px 12px} .active{background:#1976d2;color:#fff}`]
})
export class FeatureTabsComponent {
  @Input() selectedFeature: 'history'|'transfer' = 'history';
  @Output() featureChange = new EventEmitter<'history'|'transfer'>();

  set(f: 'history'|'transfer') { this.featureChange.emit(f); }
}
