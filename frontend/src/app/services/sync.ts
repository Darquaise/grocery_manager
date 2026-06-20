import { Injectable, Injector, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Product, ShoppingItem, TrackingType } from '../models';
import { OfflineDbService, OutboxOp } from './offline-db';
import { ShoppingService } from './shopping';
import { ProductsService } from './products';

/** A stock change that collided with a concurrent server-side change. */
export interface AdjustConflict {
  productId: number;
  productName: string;
  mineValue: number;
  theirsValue: number;
  serverUpdatedAt: string;
  trackingType: TrackingType;
  unit: string | null;
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
  /** Unresolved stock-change conflicts awaiting a user decision. */
  readonly conflicts = signal<AdjustConflict[]>([]);

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
    // Collapse repeated stock changes of the same product into one queued op
    // (final value wins, earliest base kept) so my own offline taps don't
    // conflict with each other.
    if (op.type === 'product.adjust') {
      const ops = await this.db.allOps();
      const existing = ops.find(
        (o) => o.type === 'product.adjust' && o.payload['productId'] === op.payload['productId'],
      );
      if (existing) {
        existing.payload = { ...existing.payload, currentValue: op.payload['currentValue'] };
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
    try {
      const ops = await this.db.allOps();
      const idMap = new Map<number, number>(); // offline temp id -> real server id
      for (const op of ops) {
        try {
          await this.apply(op, idMap);
          if (op.type.startsWith('shopping.')) shoppingChanged = true;
          if (op.id != null) await this.db.deleteOp(op.id);
        } catch (err) {
          if (err instanceof HttpErrorResponse && err.status === 0) break; // still offline
          if (
            err instanceof HttpErrorResponse &&
            err.status === 409 &&
            op.type === 'product.adjust'
          ) {
            this.recordAdjustConflict(op, err.error?.detail as Product | undefined);
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
        await firstValueFrom(this.http.patch(`/api/shopping/items/${id}`, { state: p['state'] }));
        break;
      }
      case 'shopping.remove': {
        const id = p['itemId'] as number;
        if (id < 0) return; // never reached the server — nothing to delete
        await firstValueFrom(this.http.delete(`/api/shopping/items/${id}`));
        break;
      }
      case 'product.adjust': {
        await firstValueFrom(
          this.http.post(`/api/products/${p['productId']}/adjust`, {
            current_value: p['currentValue'],
            expected_updated_at: op.baseUpdatedAt ?? null,
          }),
        );
        break;
      }
    }
  }

  private recordAdjustConflict(op: OutboxOp, server: Product | undefined): void {
    if (!server) return;
    const mine = op.payload['currentValue'] as number;
    if (server.current_value === mine) return; // same result → resolve silently
    this.conflicts.update((cs) => [
      ...cs.filter((c) => c.productId !== server.id),
      {
        productId: server.id,
        productName: server.name,
        mineValue: mine,
        theirsValue: server.current_value,
        serverUpdatedAt: server.updated_at,
        trackingType: server.tracking_type,
        unit: server.unit,
      },
    ]);
  }

  /** Keep my offline value: re-queue the adjust based on the new server state. */
  async resolveKeepMine(c: AdjustConflict): Promise<void> {
    this.conflicts.update((cs) => cs.filter((x) => x.productId !== c.productId));
    await this.enqueue({
      type: 'product.adjust',
      payload: { productId: c.productId, currentValue: c.mineValue },
      baseUpdatedAt: c.serverUpdatedAt,
    });
    void this.flush();
  }

  /** Accept the other person's value: drop mine, refresh the product cache. */
  async resolveKeepTheirs(c: AdjustConflict): Promise<void> {
    this.conflicts.update((cs) => cs.filter((x) => x.productId !== c.productId));
    try {
      await this.injector.get(ProductsService).list();
    } catch {
      /* offline */
    }
  }

  private async refreshState(): Promise<void> {
    const ops = await this.db.allOps();
    this.pending.set(ops.length);
    const ids = new Set<number>();
    for (const op of ops) {
      const tempId = op.payload['tempId'];
      const itemId = op.payload['itemId'];
      if (op.type === 'shopping.add' && typeof tempId === 'number') ids.add(tempId);
      if (
        (op.type === 'shopping.toggle' || op.type === 'shopping.remove') &&
        typeof itemId === 'number'
      ) {
        ids.add(itemId);
      }
    }
    this.pendingShoppingIds.set(ids);
  }
}
