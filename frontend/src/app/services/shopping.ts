import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ShoppingItem, ShoppingState, Trip } from '../models';

const CACHE_KEY = 'grocery.shopping.cache';
const QUEUE_KEY = 'grocery.shopping.queue';

/** A pending check-off that failed to reach the server (resilient-online). */
interface QueuedToggle {
  itemId: number;
  state: ShoppingState;
}

@Injectable({ providedIn: 'root' })
export class ShoppingService {
  private http = inject(HttpClient);

  /** The active list (open + in-cart). Cached in localStorage for fast reads. */
  readonly items = signal<ShoppingItem[]>(this.readCache());
  readonly cartCount = computed(() => this.items().filter((i) => i.state === 'inCart').length);

  constructor() {
    // Retry queued check-offs when connectivity returns.
    window.addEventListener('online', () => void this.flushQueue());
  }

  async load(): Promise<void> {
    try {
      const items = await firstValueFrom(this.http.get<ShoppingItem[]>('/api/shopping/items'));
      this.items.set(items);
      this.writeCache(items);
      await this.flushQueue();
    } catch {
      // Offline: keep whatever is cached.
    }
  }

  /** Optimistic check-off / un-check. Updates the UI immediately and retries on
   * failure (queued until the network is back). */
  async setState(item: ShoppingItem, state: ShoppingState): Promise<void> {
    this.patchLocal(item.id, { state });
    try {
      await firstValueFrom(
        this.http.patch(`/api/shopping/items/${item.id}`, { state }),
      );
    } catch {
      this.enqueue({ itemId: item.id, state });
    }
  }

  async add(displayName: string, amountText?: string, productId?: number): Promise<void> {
    const created = await firstValueFrom(
      this.http.post<ShoppingItem>('/api/shopping/items', {
        display_name: displayName,
        amount_text: amountText ?? null,
        product_id: productId ?? null,
      }),
    );
    const next = [...this.items(), created].sort((a, b) =>
      a.display_name.localeCompare(b.display_name),
    );
    this.items.set(next);
    this.writeCache(next);
  }

  /** Remove an entry (auto -> snoozed server-side, manual -> deleted). */
  async remove(item: ShoppingItem): Promise<void> {
    const next = this.items().filter((i) => i.id !== item.id);
    this.items.set(next);
    this.writeCache(next);
    try {
      await firstValueFrom(this.http.delete(`/api/shopping/items/${item.id}`));
    } catch {
      await this.load(); // resync on failure
    }
  }

  async complete(totalPrice: number | null): Promise<Trip> {
    const trip = await firstValueFrom(
      this.http.post<Trip>('/api/shopping/complete', { total_price: totalPrice }),
    );
    await this.load();
    return trip;
  }

  listTrips(): Promise<Trip[]> {
    return firstValueFrom(this.http.get<Trip[]>('/api/shopping/trips'));
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private patchLocal(id: number, patch: Partial<ShoppingItem>): void {
    const next = this.items().map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.items.set(next);
    this.writeCache(next);
  }

  private async flushQueue(): Promise<void> {
    const queue = this.readQueue();
    const remaining: QueuedToggle[] = [];
    for (const q of queue) {
      try {
        await firstValueFrom(
          this.http.patch(`/api/shopping/items/${q.itemId}`, { state: q.state }),
        );
      } catch {
        remaining.push(q); // still offline — keep it queued
      }
    }
    this.writeQueue(remaining);
  }

  private enqueue(toggle: QueuedToggle): void {
    const queue = this.readQueue().filter((q) => q.itemId !== toggle.itemId);
    queue.push(toggle);
    this.writeQueue(queue);
  }

  private readCache(): ShoppingItem[] {
    return this.readJson<ShoppingItem[]>(CACHE_KEY) ?? [];
  }

  private writeCache(items: ShoppingItem[]): void {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  }

  private readQueue(): QueuedToggle[] {
    return this.readJson<QueuedToggle[]>(QUEUE_KEY) ?? [];
  }

  private writeQueue(queue: QueuedToggle[]): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  private readJson<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
}
