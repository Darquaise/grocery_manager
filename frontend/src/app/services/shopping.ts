import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ShoppingItem, ShoppingState, Trip } from '../models';
import { OfflineDbService } from './offline-db';
import { SyncService } from './sync';
import { AuthService } from './auth';

const CACHE_KEY = 'shopping';

@Injectable({ providedIn: 'root' })
export class ShoppingService {
  private http = inject(HttpClient);
  private db = inject(OfflineDbService);
  private sync = inject(SyncService);
  private auth = inject(AuthService);

  /** The active list (open + in-cart). Cached in IndexedDB for offline reads. */
  readonly items = signal<ShoppingItem[]>([]);
  readonly cartCount = computed(() => this.items().filter((i) => i.state === 'inCart').length);

  constructor() {
    void this.hydrate();
  }

  private async hydrate(): Promise<void> {
    const cached = await this.db.getCache<ShoppingItem[]>(CACHE_KEY);
    if (cached && this.items().length === 0) this.items.set(cached.data);
  }

  /** Push queued changes first, then pull the server truth. Offline: keep cache. */
  async load(): Promise<void> {
    await this.sync.flush();
    await this.reloadFromServer();
  }

  async reloadFromServer(): Promise<void> {
    try {
      const items = await firstValueFrom(this.http.get<ShoppingItem[]>('/api/shopping/items'));
      this.setItems(items);
    } catch {
      // offline / unreachable — keep whatever is cached
    }
  }

  /** Optimistic check-off / un-check; queued + flushed (works offline). */
  async setState(item: ShoppingItem, state: ShoppingState): Promise<void> {
    this.setItems(this.items().map((i) => (i.id === item.id ? { ...i, state } : i)));
    await this.sync.enqueue({ type: 'shopping.toggle', payload: { itemId: item.id, state } });
    void this.sync.flush();
  }

  /** Optimistic add with a temporary id (reconciled to the real id on sync). */
  async add(displayName: string, amountText?: string, productId?: number): Promise<void> {
    const tempId = -Date.now();
    const optimistic: ShoppingItem = {
      id: tempId,
      product_id: productId ?? null,
      display_name: displayName,
      amount_text: amountText ?? null,
      source: 'manual',
      added_by: this.auth.user()?.id ?? null,
      state: 'open',
      ignored_until_restock: false,
    };
    this.setItems(
      [...this.items(), optimistic].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    );
    await this.sync.enqueue({
      type: 'shopping.add',
      payload: {
        tempId,
        display_name: displayName,
        amount_text: amountText ?? null,
        product_id: productId ?? null,
      },
    });
    void this.sync.flush();
  }

  /** Remove an entry (auto -> snoozed server-side, manual -> deleted). */
  async remove(item: ShoppingItem): Promise<void> {
    this.setItems(this.items().filter((i) => i.id !== item.id));
    await this.sync.enqueue({ type: 'shopping.remove', payload: { itemId: item.id } });
    void this.sync.flush();
  }

  /** Finish the trip → archive. Online-only (offline the button just retries). */
  async complete(totalPrice: number | null): Promise<Trip> {
    const trip = await firstValueFrom(
      this.http.post<Trip>('/api/shopping/complete', { total_price: totalPrice }),
    );
    await this.reloadFromServer();
    return trip;
  }

  listTrips(): Promise<Trip[]> {
    return firstValueFrom(this.http.get<Trip[]>('/api/shopping/trips'));
  }

  private setItems(items: ShoppingItem[]): void {
    this.items.set(items);
    void this.db.setCache(CACHE_KEY, items);
  }
}
