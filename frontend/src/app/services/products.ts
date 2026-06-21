import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Product, ProductInput, StockInput } from '../models';
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

  /** Optimistically replace a cached product (e.g. a stock change made offline). */
  async putCached(product: Product): Promise<void> {
    const entry = await this.db.getCache<Product[]>(CACHE_KEY);
    if (!entry) return;
    await this.db.setCache(
      CACHE_KEY,
      entry.data.map((p) => (p.id === product.id ? product : p)),
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

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/products/${id}`));
  }

  // ── stock ───────────────────────────────────────────────────────────────────

  addStock(productId: number, data: StockInput): Promise<Product> {
    return firstValueFrom(this.http.post<Product>(`/api/products/${productId}/stock`, data));
  }

  adjustStock(
    productId: number,
    stockId: number,
    data: { status_level?: number; remaining?: number; expected_updated_at?: string | null },
  ): Promise<Product> {
    return firstValueFrom(
      this.http.patch<Product>(`/api/products/${productId}/stock/${stockId}`, data),
    );
  }

  removeStock(productId: number, stockId: number): Promise<Product> {
    return firstValueFrom(this.http.delete<Product>(`/api/products/${productId}/stock/${stockId}`));
  }
}
