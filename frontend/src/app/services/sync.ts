import { Injectable, Injector, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ShoppingItem, StockItem, TrackingType } from '../models';
import { OfflineDbService, OutboxOp } from './offline-db';
import { ShoppingService } from './shopping';
import { ProductsService } from './products';

/** A stock change that collided with a concurrent server-side change. */
export interface StockConflict {
  productId: number;
  stockId: number;
  productName: string;
  trackingType: TrackingType;
  field: 'status_level' | 'remaining';
  mineValue: number;
  theirsValue: number;
  serverUpdatedAt: string;
}

/**
 * Replays the offline write queue (outbox) against the server and surfaces
 * pending/conflict state. Triggered on reconnect, app focus, app start and
 * after each local mutation; ShoppingService/ProductDetail enqueue into it.
 * Domain services are resolved lazily (via Injector) to avoid a DI cycle.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private db = inject(OfflineDbService);
  private http = inject(HttpClient);
  private injector = inject(Injector);

  /** Number of queued, not-yet-synced operations. */
  readonly pending = signal(0);
  /** Shopping item ids (incl. temp ids) that still have a queued change. */
  readonly pendingShoppingIds = signal<ReadonlySet<number>>(new Set());
  /** Product ids that still have a queued stock change. */
  readonly pendingProductIds = signal<ReadonlySet<number>>(new Set());
  /** Unresolved stock-change conflicts awaiting a user decision. */
  readonly conflicts = signal<StockConflict[]>([]);

  private flushing = false;

  constructor() {
    window.addEventListener('online', () => void this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.flush();
    });
    void this.refreshState();
    void this.flush();
  }

  async enqueue(op: Omit<OutboxOp, 'id' | 'createdAt'>): Promise<void> {
    // Collapse repeated adjusts of the same stock package into one queued op
    // (final value wins, earliest base kept) so my own offline taps don't
    // conflict with each other.
    if (op.type === 'stock.adjust') {
      const ops = await this.db.allOps();
      const existing = ops.find(
        (o) => o.type === 'stock.adjust' && o.payload['stockId'] === op.payload['stockId'],
      );
      if (existing) {
        existing.payload = {
          ...existing.payload,
          field: op.payload['field'],
          value: op.payload['value'],
        };
        await this.db.putOp(existing);
        await this.refreshState();
        return;
      }
    }
    await this.db.addOp({ ...op, createdAt: Date.now() });
    await this.refreshState();
  }

  /** Push all queued operations in order. Stops (keeps the rest) when offline. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    let shoppingChanged = false;
    let stockChanged = false;
    try {
      const ops = await this.db.allOps();
      const idMap = new Map<number, number>(); // offline temp id -> real server id
      for (const op of ops) {
        try {
          await this.apply(op, idMap);
          if (op.type.startsWith('shopping.')) shoppingChanged = true;
          if (op.type.startsWith('stock.')) stockChanged = true;
          if (op.id != null) await this.db.deleteOp(op.id);
        } catch (err) {
          if (err instanceof HttpErrorResponse && err.status === 0) break; // still offline
          if (
            err instanceof HttpErrorResponse &&
            err.status === 409 &&
            op.type === 'stock.adjust'
          ) {
            this.recordStockConflict(op, err.error?.detail as StockItem | undefined);
          }
          // Conflict handled, or unrecoverable server error (e.g. item gone):
          // drop the op so it can't block the rest of the queue.
          if (op.id != null) await this.db.deleteOp(op.id);
        }
      }
    } finally {
      this.flushing = false;
      await this.refreshState();
      if (shoppingChanged) {
        try {
          await this.injector.get(ShoppingService).reloadFromServer();
        } catch {
          /* offline — keep optimistic local list */
        }
      }
      if (stockChanged) {
        try {
          await this.injector.get(ProductsService).list();
        } catch {
          /* offline — keep optimistic local cache */
        }
      }
    }
  }

  private async apply(op: OutboxOp, idMap: Map<number, number>): Promise<void> {
    const p = op.payload;
    switch (op.type) {
      case 'shopping.add': {
        const created = await firstValueFrom(
          this.http.post<ShoppingItem>('/api/shopping/items', {
            display_name: p['display_name'],
            amount_text: p['amount_text'] ?? null,
            product_id: p['product_id'] ?? null,
          }),
        );
        const tempId = p['tempId'];
        if (typeof tempId === 'number') idMap.set(tempId, created.id);
        break;
      }
      case 'shopping.toggle': {
        let id = p['itemId'] as number;
        if (id < 0) id = idMap.get(id) ?? id;
        if (id < 0) return; // item was added offline and never synced — skip
        const body: Record<string, unknown> = { state: p['state'] };
        if (p['purchase_plan'] !== undefined) body['purchase_plan'] = p['purchase_plan'];
        await firstValueFrom(this.http.patch(`/api/shopping/items/${id}`, body));
        break;
      }
      case 'shopping.remove': {
        const id = p['itemId'] as number;
        if (id < 0) return; // never reached the server — nothing to delete
        await firstValueFrom(this.http.delete(`/api/shopping/items/${id}`));
        break;
      }
      case 'stock.add': {
        await firstValueFrom(
          this.http.post(`/api/products/${p['productId']}/stock`, {
            expiry_date: p['expiry_date'] ?? null,
            purchase_date: p['purchase_date'] ?? null,
            status_level: p['status_level'] ?? null,
            remaining: p['remaining'] ?? null,
            size: p['size'] ?? null,
          }),
        );
        break;
      }
      case 'stock.adjust': {
        const stockId = p['stockId'] as number;
        if (stockId < 0) return; // package was added offline and never synced — skip
        const body: Record<string, unknown> = { expected_updated_at: op.baseUpdatedAt ?? null };
        body[p['field'] as string] = p['value'];
        await firstValueFrom(
          this.http.patch(`/api/products/${p['productId']}/stock/${stockId}`, body),
        );
        break;
      }
      case 'stock.remove': {
        const stockId = p['stockId'] as number;
        if (stockId < 0) return; // never reached the server — nothing to delete
        await firstValueFrom(
          this.http.delete(`/api/products/${p['productId']}/stock/${stockId}`),
        );
        break;
      }
    }
  }

  private recordStockConflict(op: OutboxOp, server: StockItem | undefined): void {
    if (!server) return;
    const field = op.payload['field'] as 'status_level' | 'remaining';
    const mine = op.payload['value'] as number;
    const theirs = (field === 'status_level' ? server.status_level : server.remaining) ?? 0;
    if (theirs === mine) return; // same result → resolve silently
    this.conflicts.update((cs) => [
      ...cs.filter((c) => c.stockId !== server.id),
      {
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
  }

  /** Keep my offline value: re-queue the adjust based on the new server state. */
  async resolveKeepMine(c: StockConflict): Promise<void> {
    this.conflicts.update((cs) => cs.filter((x) => x.stockId !== c.stockId));
    await this.enqueue({
      type: 'stock.adjust',
      payload: {
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
    this.conflicts.update((cs) => cs.filter((x) => x.stockId !== c.stockId));
    try {
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
