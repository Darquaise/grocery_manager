import { Injectable, Injector, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Product, ShoppingItem, StockItem, TrackingType } from '../models';
import { OfflineDbService, OutboxOp } from './offline-db';
import { KitchensService } from './kitchens';

/** A stock change that collided with a concurrent server-side change. */
export interface StockConflict {
  kitchenId: number;
  productId: number;
  stockId: number;
  productName: string;
  trackingType: TrackingType;
  field: 'status_level' | 'remaining';
  mineValue: number;
  theirsValue: number;
  serverUpdatedAt: string;
}

/** A queued write the server rejected (anything except offline/handled 409) —
 * dropped from the queue, but surfaced instead of vanishing silently. */
export interface FailedOp {
  type: string;
  /** What the op was about (product name / list-entry text), best effort. */
  label: string;
  status: number;
  at: number;
}

// Cross-session sync state in the IndexedDB cache store. Namespaced with
// `sync:` so it can never collide with the `<kitchenId>:<kind>` data keys.
const STOCK_IDMAP_KEY = 'sync:stockIdMap';
const SHOPPING_IDMAP_KEY = 'sync:shoppingIdMap';
const CONFLICTS_KEY = 'sync:conflicts';
const FAILED_KEY = 'sync:failed';

/**
 * Replays the offline write queue (outbox) against the server and surfaces
 * pending/conflict state. Triggered on reconnect, app focus, app start and
 * after each local mutation; ShoppingService/ProductDetail enqueue into it.
 * Every op is stamped with the kitchen it belongs to, so a queued change still
 * reaches the right kitchen after switching. Domain services are resolved
 * lazily (via Injector) to avoid a DI cycle.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private db = inject(OfflineDbService);
  private http = inject(HttpClient);
  private injector = inject(Injector);
  private kitchens = inject(KitchensService);

  /** Number of queued, not-yet-synced operations. */
  readonly pending = signal(0);
  /** Shopping item ids (incl. temp ids) that still have a queued change. */
  readonly pendingShoppingIds = signal<ReadonlySet<number>>(new Set());
  /** Product ids that still have a queued stock change. */
  readonly pendingProductIds = signal<ReadonlySet<number>>(new Set());
  /** Unresolved stock-change conflicts awaiting a user decision. */
  readonly conflicts = signal<StockConflict[]>([]);
  /** Queued writes the server rejected — shown in a dismissible banner. */
  readonly failed = signal<FailedOp[]>([]);
  /** Bumped after each flush that pushed stock ops (and refreshed the product
   * cache) — open product pages re-read the server truth off it. */
  readonly stockSynced = signal(0);

  private flushing = false;
  /** A flush was requested while one was running — run once more afterwards
   * so ops enqueued mid-flush don't sit in the outbox until the next trigger. */
  private flushAgain = false;
  /** Optimistic temp ids (negative) → real server ids, one map per domain
   * (both use `-Date.now()`, so they could collide in one). Entities created
   * on a still-open page keep their temp id locally even after the add synced,
   * so later ops on them must be remapped or they'd be dropped. Persisted
   * (with `conflicts`/`failed`) so a restart between a synced add and a
   * still-queued follow-up op loses nothing. */
  private stockIdMap = new Map<number, number>();
  private shoppingIdMap = new Map<number, number>();
  /** Persisted state is loaded before the first flush touches it. */
  private ready: Promise<void>;

  constructor() {
    this.ready = this.restore();
    window.addEventListener('online', () => void this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.flush();
    });
    void this.refreshState();
    void this.flush();
  }

  /** Load persisted sync state; prune the id maps once nothing references them. */
  private async restore(): Promise<void> {
    const [stockMap, shoppingMap, conflicts, failed, ops] = await Promise.all([
      this.db.getCache<[number, number][]>(STOCK_IDMAP_KEY),
      this.db.getCache<[number, number][]>(SHOPPING_IDMAP_KEY),
      this.db.getCache<StockConflict[]>(CONFLICTS_KEY),
      this.db.getCache<FailedOp[]>(FAILED_KEY),
      this.db.allOps(),
    ]);
    if (ops.length > 0) {
      if (stockMap) this.stockIdMap = new Map(stockMap.data);
      if (shoppingMap) this.shoppingIdMap = new Map(shoppingMap.data);
    } else {
      // An empty outbox means no queued op can still carry a temp id, and any
      // open page re-reads server ids from the cache — safe to forget both.
      if (stockMap?.data.length) void this.db.setCache(STOCK_IDMAP_KEY, []);
      if (shoppingMap?.data.length) void this.db.setCache(SHOPPING_IDMAP_KEY, []);
    }
    if (conflicts?.data.length) this.conflicts.set(conflicts.data);
    if (failed?.data.length) this.failed.set(failed.data);
  }

  private persistMap(key: string, map: ReadonlyMap<number, number>): void {
    void this.db.setCache(key, [...map]);
  }

  private setConflicts(update: (cs: StockConflict[]) => StockConflict[]): void {
    this.conflicts.update(update);
    void this.db.setCache(CONFLICTS_KEY, this.conflicts());
  }

  async enqueue(op: Omit<OutboxOp, 'id' | 'createdAt'>): Promise<void> {
    const payload: Record<string, unknown> = {
      kitchenId: this.kitchens.activeId(),
      ...op.payload,
    };
    // Collapse repeated adjusts of the same stock package into one queued op
    // (final value wins, earliest base kept) so my own offline taps don't
    // conflict with each other.
    if (op.type === 'stock.adjust') {
      const ops = await this.db.allOps();
      const existing = ops.find(
        (o) => o.type === 'stock.adjust' && o.payload['stockId'] === payload['stockId'],
      );
      if (existing) {
        existing.payload = {
          ...existing.payload,
          field: payload['field'],
          value: payload['value'],
        };
        await this.db.putOp(existing);
        await this.refreshState();
        return;
      }
    }
    await this.db.addOp({ ...op, payload, createdAt: Date.now() });
    await this.refreshState();
  }

  /** Push all queued operations in order. Stops (keeps the rest) when offline. */
  async flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    let shoppingChanged = false;
    let stockChanged = false;
    try {
      await this.ready;
      const ops = await this.db.allOps();
      for (const op of ops) {
        try {
          await this.apply(op);
          if (op.type.startsWith('shopping.')) shoppingChanged = true;
          if (op.type.startsWith('stock.')) stockChanged = true;
          if (op.id != null) await this.db.deleteOp(op.id);
        } catch (err) {
          if (err instanceof HttpErrorResponse && err.status === 0) break; // still offline
          const conflictHandled =
            err instanceof HttpErrorResponse &&
            err.status === 409 &&
            op.type === 'stock.adjust' &&
            this.recordStockConflict(op, err.error?.detail as StockItem | undefined);
          if (!conflictHandled) {
            // A queued write the server refused (e.g. item gone, permissions,
            // 500): surface it instead of losing it silently, and reload so
            // the optimistic view of the dropped op gets replaced by the
            // server truth.
            this.recordFailure(op, err);
            if (op.type.startsWith('shopping.')) shoppingChanged = true;
            if (op.type.startsWith('stock.')) stockChanged = true;
          }
          // Either way: drop the op so it can't block the rest of the queue.
          if (op.id != null) await this.db.deleteOp(op.id);
        }
      }
    } finally {
      this.flushing = false;
      await this.refreshState();
      if (shoppingChanged) {
        try {
          const { ShoppingService } = await import('./shopping');
          await this.injector.get(ShoppingService).reloadFromServer();
        } catch {
          /* offline — keep optimistic local list */
        }
      }
      if (stockChanged) {
        try {
          const { ProductsService } = await import('./products');
          await this.injector.get(ProductsService).list();
        } catch {
          /* offline — keep optimistic local cache */
        }
        this.stockSynced.update((n) => n + 1);
      }
      if (this.flushAgain) {
        this.flushAgain = false;
        void this.flush();
      }
    }
  }

  /** API prefix for the kitchen an op was queued in (older ops without a
   * kitchenId fall back to the active kitchen). */
  private base(op: OutboxOp): string {
    const kitchenId = (op.payload['kitchenId'] as number | null) ?? this.kitchens.activeId();
    return `/api/kitchens/${kitchenId}`;
  }

  private async apply(op: OutboxOp): Promise<void> {
    const p = op.payload;
    const base = this.base(op);
    switch (op.type) {
      case 'shopping.add': {
        const created = await firstValueFrom(
          this.http.post<ShoppingItem>(`${base}/shopping/items`, {
            display_name: p['display_name'],
            amount_text: p['amount_text'] ?? null,
            product_id: p['product_id'] ?? null,
          }),
        );
        const tempId = p['tempId'];
        if (typeof tempId === 'number') {
          this.shoppingIdMap.set(tempId, created.id);
          this.persistMap(SHOPPING_IDMAP_KEY, this.shoppingIdMap);
        }
        break;
      }
      case 'shopping.toggle': {
        const id = realId(this.shoppingIdMap, p['itemId'] as number);
        if (id < 0) return; // item was added offline and never synced — skip
        const body: Record<string, unknown> = { state: p['state'] };
        if (p['purchase_plan'] !== undefined) body['purchase_plan'] = p['purchase_plan'];
        await firstValueFrom(this.http.patch(`${base}/shopping/items/${id}`, body));
        break;
      }
      case 'shopping.remove': {
        const id = realId(this.shoppingIdMap, p['itemId'] as number);
        if (id < 0) return; // never reached the server — nothing to delete
        await firstValueFrom(this.http.delete(`${base}/shopping/items/${id}`));
        break;
      }
      case 'stock.add': {
        const created = await firstValueFrom(
          this.http.post<Product & { created_stock_id: number }>(
            `${base}/products/${p['productId']}/stock`,
            {
              expiry_date: p['expiry_date'] ?? null,
              purchase_date: p['purchase_date'] ?? null,
              status_level: p['status_level'] ?? null,
              remaining: p['remaining'] ?? null,
              size: p['size'] ?? null,
            },
          ),
        );
        const tempId = p['tempId'];
        if (typeof tempId === 'number') {
          this.stockIdMap.set(tempId, created.created_stock_id);
          this.persistMap(STOCK_IDMAP_KEY, this.stockIdMap);
        }
        break;
      }
      case 'stock.adjust': {
        const stockId = realId(this.stockIdMap, p['stockId'] as number);
        if (stockId < 0) return; // package was added offline and never synced — skip
        const body: Record<string, unknown> = { expected_updated_at: op.baseUpdatedAt ?? null };
        body[p['field'] as string] = p['value'];
        await firstValueFrom(
          this.http.patch(`${base}/products/${p['productId']}/stock/${stockId}`, body),
        );
        break;
      }
      case 'stock.remove': {
        const stockId = realId(this.stockIdMap, p['stockId'] as number);
        if (stockId < 0) return; // never reached the server — nothing to delete
        await firstValueFrom(
          this.http.delete(`${base}/products/${p['productId']}/stock/${stockId}`),
        );
        break;
      }
    }
  }

  /** Returns whether the 409 was dealt with (dialog queued or same value). */
  private recordStockConflict(op: OutboxOp, server: StockItem | undefined): boolean {
    if (!server) return false;
    const field = op.payload['field'] as 'status_level' | 'remaining';
    const mine = op.payload['value'] as number;
    const theirs = (field === 'status_level' ? server.status_level : server.remaining) ?? 0;
    if (theirs === mine) return true; // same result → resolve silently
    this.setConflicts((cs) => [
      ...cs.filter((c) => c.stockId !== server.id),
      {
        kitchenId:
          (op.payload['kitchenId'] as number | null) ?? this.kitchens.activeId() ?? 0,
        productId: op.payload['productId'] as number,
        stockId: server.id,
        productName: (op.payload['productName'] as string) ?? '',
        trackingType: (op.payload['trackingType'] as TrackingType) ?? 'counter',
        field,
        mineValue: mine,
        theirsValue: theirs,
        serverUpdatedAt: server.updated_at,
      },
    ]);
    return true;
  }

  private recordFailure(op: OutboxOp, err: unknown): void {
    const p = op.payload;
    this.failed.update((fs) => [
      ...fs.slice(-19), // keep the banner bounded
      {
        type: op.type,
        label: (p['productName'] as string) ?? (p['display_name'] as string) ?? '',
        status: err instanceof HttpErrorResponse ? err.status : -1,
        at: Date.now(),
      },
    ]);
    void this.db.setCache(FAILED_KEY, this.failed());
  }

  /** The failure banner was dismissed. */
  clearFailed(): void {
    this.failed.set([]);
    void this.db.setCache(FAILED_KEY, []);
  }

  /** Keep my offline value: re-queue the adjust based on the new server state. */
  async resolveKeepMine(c: StockConflict): Promise<void> {
    this.setConflicts((cs) => cs.filter((x) => x.stockId !== c.stockId));
    await this.enqueue({
      type: 'stock.adjust',
      payload: {
        kitchenId: c.kitchenId,
        productId: c.productId,
        stockId: c.stockId,
        field: c.field,
        value: c.mineValue,
        productName: c.productName,
        trackingType: c.trackingType,
      },
      baseUpdatedAt: c.serverUpdatedAt,
    });
    void this.flush();
  }

  /** Accept the other person's value: drop mine, refresh the product cache. */
  async resolveKeepTheirs(c: StockConflict): Promise<void> {
    this.setConflicts((cs) => cs.filter((x) => x.stockId !== c.stockId));
    try {
      const { ProductsService } = await import('./products');
      await this.injector.get(ProductsService).list();
    } catch {
      /* offline */
    }
  }

  private async refreshState(): Promise<void> {
    const ops = await this.db.allOps();
    this.pending.set(ops.length);
    const shoppingIds = new Set<number>();
    const productIds = new Set<number>();
    for (const op of ops) {
      const tempId = op.payload['tempId'];
      const itemId = op.payload['itemId'];
      if (op.type === 'shopping.add' && typeof tempId === 'number') shoppingIds.add(tempId);
      if (
        (op.type === 'shopping.toggle' || op.type === 'shopping.remove') &&
        typeof itemId === 'number'
      ) {
        shoppingIds.add(itemId);
      }
      if (op.type.startsWith('stock.') && typeof op.payload['productId'] === 'number') {
        productIds.add(op.payload['productId'] as number);
      }
    }
    this.pendingShoppingIds.set(shoppingIds);
    this.pendingProductIds.set(productIds);
  }
}

/** Resolve an optimistic temp id (negative) to the real one once its add has
 * synced; unresolvable temp ids stay negative and the caller skips the op. */
function realId(map: ReadonlyMap<number, number>, id: number): number {
  return id < 0 ? (map.get(id) ?? id) : id;
}
