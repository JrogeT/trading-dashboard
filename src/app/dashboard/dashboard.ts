import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { SignalsService } from '../services/signals.service';
import { BinanceService } from '../services/binance.service';
import { Signal } from '../models/signal.model';
import { TextDialogComponent } from './text-dialog';

interface TreeRow {
  signal: Signal;
  depth: number;       // 0 = 4H, 1 = 1H, 2 = 15m
  parentId: string | null;
  hasChildren: boolean;
}

@Component({
  selector: 'app-dashboard',
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
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit, OnDestroy {
  private signalsService = inject(SignalsService);
  private binanceService = inject(BinanceService);
  private dialog = inject(MatDialog);
  private priceSub: Subscription | null = null;

  signals = signal<Signal[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  collapsed = signal<Set<string>>(new Set());
  prices = signal<Map<string, number>>(new Map());

  displayedColumns = [
    'toggle',
    'created_at',
    'signal',
    'validated_signal',
    'status',
    'confidence',
    'quality',
    'entry',
    'stop_loss',
    'take_profit',
    'override',
    'override_reason',
    'context',
    'entry_details',
  ];

  treeRows = computed<TreeRow[]>(() => {
    return this.buildTree(this.signals());
  });

  visibleRows = computed<TreeRow[]>(() => {
    const all = this.treeRows();
    const collapsedSet = this.collapsed();
    return all.filter(row => {
      // Check if any ancestor is collapsed
      let parentId = row.parentId;
      while (parentId) {
        if (collapsedSet.has(parentId)) return false;
        const parent = all.find(r => r.signal.id === parentId);
        parentId = parent?.parentId ?? null;
      }
      return true;
    });
  });

  async ngOnInit() {
    await this.loadSignals();
  }

  async loadSignals() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.signalsService.getSignals();
      this.signals.set(data);
      // Start with all 4H and 1H rows collapsed
      const tree = this.buildTree(data);
      const collapsedIds = new Set(
        tree.filter(r => r.hasChildren).map(r => r.signal.id)
      );
      this.collapsed.set(collapsedIds);
      // Subscribe to live prices
      const assets = [...new Set(data.map(s => s.asset))];
      this.binanceService.subscribe(assets);
      this.priceSub = this.binanceService.price$.subscribe(tick => {
        this.prices.update(map => {
          const next = new Map(map);
          next.set(tick.symbol, tick.price);
          return next;
        });
      });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load signals');
    } finally {
      this.loading.set(false);
    }
  }

  private buildTree(signals: Signal[]): TreeRow[] {
    // Sort by time ascending — parents come first, children after
    const sorted = [...signals].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const rows: TreeRow[] = [];
    const parentMap = new Map<string, string>(); // signal id -> parent id
    const hasChildrenSet = new Set<string>();

    // Track current parent at each level per asset
    const current4H = new Map<string, string>(); // asset -> 4H signal id
    const current1H = new Map<string, string>(); // asset -> 1H signal id

    for (const s of sorted) {
      const tf = s.timeframe;
      const is15M = tf === '15' || tf === '15m' || tf === '15M';

      if (tf === '4H') {
        // New 4H resets the 1H tracker for this asset
        current4H.set(s.asset, s.id);
        current1H.delete(s.asset);
        rows.push({ signal: s, depth: 0, parentId: null, hasChildren: false });
      } else if (tf === '1H') {
        const parent4H = current4H.get(s.asset) ?? null;
        current1H.set(s.asset, s.id);
        if (parent4H) {
          parentMap.set(s.id, parent4H);
          hasChildrenSet.add(parent4H);
        }
        rows.push({ signal: s, depth: parent4H ? 1 : 0, parentId: parent4H, hasChildren: false });
      } else if (is15M) {
        const parent1H = current1H.get(s.asset) ?? null;
        const parent4H = current4H.get(s.asset) ?? null;
        const parentId = parent1H ?? parent4H ?? null;
        const depth = parent1H ? 2 : (parent4H ? 1 : 0);
        if (parentId) {
          parentMap.set(s.id, parentId);
          hasChildrenSet.add(parentId);
        }
        rows.push({ signal: s, depth, parentId, hasChildren: false });
      } else {
        rows.push({ signal: s, depth: 0, parentId: null, hasChildren: false });
      }
    }

    // Mark which rows have children
    for (const row of rows) {
      row.hasChildren = hasChildrenSet.has(row.signal.id);
    }

    // Group by root (depth 0), reverse groups so newest first, keep children below parent
    const groups: TreeRow[][] = [];
    let currentGroup: TreeRow[] = [];
    for (const row of rows) {
      if (row.depth === 0 && currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(row);
    }
    if (currentGroup.length > 0) groups.push(currentGroup);

    // Within each group, also reverse 1H sub-groups so newest 1H is first but its 15M stay below it
    for (const group of groups) {
      const parent = group[0]; // 4H row
      const subGroups: TreeRow[][] = [];
      let currentSub: TreeRow[] = [];
      for (let i = 1; i < group.length; i++) {
        if (group[i].depth === 1 && currentSub.length > 0) {
          subGroups.push(currentSub);
          currentSub = [];
        }
        currentSub.push(group[i]);
      }
      if (currentSub.length > 0) subGroups.push(currentSub);

      group.length = 0;
      group.push(parent, ...subGroups.flat());
    }

    groups.reverse();
    return groups.flat();
  }

  toggleRow(id: string) {
    this.collapsed.update(set => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  isCollapsed(id: string): boolean {
    return this.collapsed().has(id);
  }

  get sentiment3d() { return this.getSentiment(3); }
  get sentiment7d() { return this.getSentiment(7); }
  get quality3d() { return this.getQuality(3); }
  get quality7d() { return this.getQuality(7); }

  get avgConfYesterday(): number {
    const yesterday = this.getYesterdaySignals();
    if (yesterday.length === 0) return 0;
    return yesterday.reduce((sum, s) => sum + s.confidence, 0) / yesterday.length;
  }

  get signalsYesterday(): number {
    return this.getYesterdaySignals().length;
  }

  private getYesterdaySignals(): Signal[] {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    return this.signals().filter(s => {
      const d = new Date(s.created_at);
      return d >= startOfYesterday && d < startOfToday;
    });
  }

  get lastSignalAgo(): string {
    const sigs = this.signals();
    if (sigs.length === 0) return '-';
    const latest = new Date(sigs[0].created_at);
    const diff = Date.now() - latest.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ago`;
  }

  private getSentiment(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const recent = this.signals().filter(s => new Date(s.created_at) >= cutoff);
    const longSigs = recent.filter(s => s.validated_signal === 'LONG');
    const shortSigs = recent.filter(s => s.validated_signal === 'SHORT');
    const longs = longSigs.length;
    const shorts = shortSigs.length;
    const noTrade = recent.filter(s => s.validated_signal !== 'LONG' && s.validated_signal !== 'SHORT').length;
    const total = longs + shorts + noTrade;

    return {
      longs, shorts, noTrade, total,
      longPct: total > 0 ? Math.round((longs / total) * 100) : 0,
      noTradePct: total > 0 ? Math.round((noTrade / total) * 100) : 0,
      shortPct: total > 0 ? Math.round((shorts / total) * 100) : 0,
    };
  }

  private getQuality(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const recent = this.signals().filter(s => new Date(s.created_at) >= cutoff && s.quality);
    const high = recent.filter(s => s.quality === 'HIGH').length;
    const medium = recent.filter(s => s.quality === 'MEDIUM').length;
    const low = recent.filter(s => s.quality === 'LOW').length;
    const total = high + medium + low;
    return { high, medium, low, total };
  }

  ngOnDestroy() {
    this.priceSub?.unsubscribe();
    this.binanceService.close();
  }

  getPrice(asset: string): number | null {
    const symbol = asset.toUpperCase() + 'USDT';
    return this.prices().get(symbol) ?? null;
  }

  getSignalIcon(signalType: string): string {
    switch (signalType) {
      case 'LONG': return 'trending_up';
      case 'SHORT': return 'trending_down';
      default: return 'do_not_disturb_on';
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

  getRowClass(row: TreeRow): string {
    const tf = row.signal.timeframe;
    const base = tf === '4H' ? 'row-4h' : tf === '1H' ? 'row-1h' : 'row-15m';
    return `${base} depth-${row.depth}`;
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
