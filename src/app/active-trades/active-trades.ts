import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { SignalsService } from '../services/signals.service';
import { BinanceService } from '../services/binance.service';
import { Signal } from '../models/signal.model';
import { TextDialogComponent } from '../dashboard/text-dialog';

@Component({
  selector: 'app-active-trades',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatTooltipModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
  ],
  templateUrl: './active-trades.html',
  styleUrl: './active-trades.scss',
})
export class ActiveTrades implements OnInit, OnDestroy {
  private signalsService = inject(SignalsService);
  private binanceService = inject(BinanceService);
  private dialog = inject(MatDialog);
  private priceSub: Subscription | null = null;

  trades = signal<Signal[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  livePrices = signal<Record<string, number>>({});
  isLive = signal(false);

  displayedColumns = [
    'created_at',
    'signal',
    'validated_signal',
    'confidence',
    'quality',
    'entry',
    'stop_loss',
    'take_profit',
    'price',
    'pnl',
    'override',
    'override_reason',
    'context',
    'entry_details',
  ];

  async ngOnInit() {
    await this.loadTrades();
  }

  ngOnDestroy() {
    this.priceSub?.unsubscribe();
    this.binanceService.close();
  }

  async loadTrades() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.signalsService.getActiveTrades();
      this.trades.set(data);
      this.startPriceStream(data);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load active trades');
    } finally {
      this.loading.set(false);
    }
  }

  private startPriceStream(trades: Signal[]) {
    this.priceSub?.unsubscribe();
    this.binanceService.close();
    this.isLive.set(false);

    const assets = [...new Set(trades.map(t => t.asset))];
    if (assets.length === 0) return;

    this.binanceService.subscribe(assets);

    this.priceSub = this.binanceService.price$.subscribe(tick => {
      this.isLive.set(true);
      this.livePrices.update(prices => ({
        ...prices,
        [tick.symbol]: tick.price,
      }));
    });
  }

  getSymbol(asset: string): string {
    return (asset + 'USDT').toUpperCase();
  }

  getLivePrice(row: Signal): number | null {
    return this.livePrices()[this.getSymbol(row.asset)] ?? null;
  }

  getPnl(row: Signal): number | null {
    const price = this.getLivePrice(row);
    if (price === null || row.entry === null) return null;
    if (row.validated_signal === 'LONG') {
      return ((price - row.entry) / row.entry) * 100;
    } else if (row.validated_signal === 'SHORT') {
      return ((row.entry - price) / row.entry) * 100;
    }
    return null;
  }

  getSignalIcon(signalType: string): string {
    switch (signalType) {
      case 'LONG': return 'trending_up';
      case 'SHORT': return 'trending_down';
      default: return 'remove';
    }
  }

  getSignalColor(signalType: string): string {
    switch (signalType) {
      case 'LONG': return '#4caf50';
      case 'SHORT': return '#f44336';
      default: return '#9e9e9e';
    }
  }

  getQualityIcon(quality: string): string {
    switch (quality) {
      case 'HIGH': return 'verified';
      case 'MEDIUM': return 'check_circle';
      default: return 'cancel';
    }
  }

  getQualityColor(quality: string): string {
    switch (quality) {
      case 'HIGH': return '#4caf50';
      case 'MEDIUM': return '#ff9800';
      default: return '#f44336';
    }
  }

  getRowClass(row: Signal): string {
    switch (row.timeframe) {
      case '4H': return 'row-4h';
      case '1H': return 'row-1h';
      case '15': case '15m': case '15M': return 'row-15m';
      default: return '';
    }
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  formatNumber(val: number | null): string {
    if (val === null) return '-';
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  copyToClipboard(val: number | null) {
    if (val === null) return;
    navigator.clipboard.writeText(val.toString());
  }

  showFullText(title: string, text: string | null) {
    this.dialog.open(TextDialogComponent, {
      data: { title, text: text || 'No data' },
      width: '600px',
      maxHeight: '80vh',
    });
  }
}
