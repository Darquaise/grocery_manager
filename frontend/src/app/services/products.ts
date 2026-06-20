import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Product, ProductInput } from '../models';
import { OfflineDbService } from './offline-db';

const CACHE_KEY = 'products';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);
  private db = inject(OfflineDbService);

  async list(includeDeleted = false): Promise<Product[]> {
    const url = includeDeleted ? '/api/products?include_deleted=true' : '/api/products';
    const items = await firstValueFrom(this.http.get<Product[]>(url));
    if (!includeDeleted) void this.db.setCache(CACHE_KEY, items);
    return items;
  }

  /** Last cached active list for instant/offline rendering (null if never fetched). */
  async cached(): Promise<Product[] | null> {
    return (await this.db.getCache<Product[]>(CACHE_KEY))?.data ?? null;
  }

  /** A single product from the cached list (for offline product-detail). */
  async cachedOne(id: number): Promise<Product | null> {
    const entry = await this.db.getCache<Product[]>(CACHE_KEY);
    return entry?.data.find((p) => p.id === id) ?? null;
  }

  /** Optimistically patch the cached list (e.g. a stock change made offline). */
  async patchCached(id: number, partial: Partial<Product>): Promise<void> {
    const entry = await this.db.getCache<Product[]>(CACHE_KEY);
    if (!entry) return;
    await this.db.setCache(
      CACHE_KEY,
      entry.data.map((p) => (p.id === id ? { ...p, ...partial } : p)),
    );
  }

  get(id: number): Promise<Product> {
    return firstValueFrom(this.http.get<Product>(`/api/products/${id}`));
  }

  create(data: ProductInput): Promise<Product> {
    return firstValueFrom(this.http.post<Product>('/api/products', data));
  }

  update(id: number, data: Partial<ProductInput>): Promise<Product> {
    return firstValueFrom(this.http.patch<Product>(`/api/products/${id}`, data));
  }

  adjust(id: number, currentValue: number): Promise<Product> {
    return firstValueFrom(
      this.http.post<Product>(`/api/products/${id}/adjust`, { current_value: currentValue }),
    );
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/products/${id}`));
  }

  restore(id: number): Promise<Product> {
    return firstValueFrom(this.http.post<Product>(`/api/products/${id}/restore`, {}));
  }
}
