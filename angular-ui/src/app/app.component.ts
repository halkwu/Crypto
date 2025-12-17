import { Component } from '@angular/core';
import { Chain } from './models';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  selectedChain: Chain = 'BTC';
  selectedFeature: 'history' | 'transfer' = 'history';

  // example: selected account string (wallet id/address)
  selectedAccount = '';

  onChainChange(chain: Chain) {
    this.selectedChain = chain;
  }

  onFeatureChange(feature: 'history' | 'transfer') {
    this.selectedFeature = feature;
  }

  onAccountChange(account: string) {
    this.selectedAccount = account;
  }
}
