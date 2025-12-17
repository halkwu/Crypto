import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { AppComponent } from './app.component';
import { ChainSelectorComponent } from './chain-selector.component';
import { FeatureTabsComponent } from './feature-tabs.component';
import { HistoryComponent } from './history.component';
import { TransferComponent } from './transfer.component';

@NgModule({
  declarations: [
    AppComponent,
    ChainSelectorComponent,
    FeatureTabsComponent,
    HistoryComponent,
    TransferComponent,
  ],
  imports: [BrowserModule, FormsModule, ReactiveFormsModule, HttpClientModule],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
