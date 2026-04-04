import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { SignalsService } from '../services/signals.service';
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
export class Dashboard implements OnInit {
  private signalsService = inject(SignalsService);
  private dialog = inject(MatDialog);

  signals = signal<Signal[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  collapsed = signal<Set<string>>(new Set());

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

  get totalSignals(): number {
    return this.signals().length;
  }

  get longSignals(): number {
    return this.signals().filter((s) => s.validated_signal === 'LONG').length;
  }

  get shortSignals(): number {
    return this.signals().filter((s) => s.validated_signal === 'SHORT').length;
  }

  get avgConfidence(): number {
    const sigs = this.signals();
    if (sigs.length === 0) return 0;
    return sigs.reduce((sum, s) => sum + s.confidence, 0) / sigs.length;
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
