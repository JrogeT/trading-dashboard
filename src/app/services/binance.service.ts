import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PriceTick {
  symbol: string;
  price: number;
}

@Injectable({ providedIn: 'root' })
export class BinanceService implements OnDestroy {
  private ws: WebSocket | null = null;
  private subscriptions = new Set<string>();

  price$ = new Subject<PriceTick>();

  private assetToSymbol(asset: string): string {
    return asset.toLowerCase() + 'usdt';
  }

  subscribe(assets: string[]) {
    this.close();

    const symbols = [...new Set(assets.map(a => this.assetToSymbol(a)))];
    if (symbols.length === 0) return;

    const streams = symbols.map(s => `${s}@trade`).join('/');
    this.ws = new WebSocket(`${environment.binanceWsUrl}?streams=${streams}`);

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.data?.s && msg.data?.p) {
        this.price$.next({
          symbol: msg.data.s.toUpperCase(),
          price: parseFloat(msg.data.p),
        });
      }
    };

    this.ws.onerror = () => this.ws?.close();
    symbols.forEach(s => this.subscriptions.add(s));
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }

  ngOnDestroy() {
    this.close();
  }
}
