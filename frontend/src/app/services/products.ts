import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Product, ProductInput, StockInput } from '../models';
import { OfflineDbService } from './offline-db';
import { KitchensService } from './kitchens';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);
  private db = inject(OfflineDbService);
  private kitchens = inject(KitchensService);

  private cacheKey(): string {
    return this.kitchens.cacheKey('products');
  }

  async list(includeDeleted = false): Promise<Product[]> {
    const base = `${this.kitchens.base()}/products`;
    const url = includeDeleted ? `${base}?include_deleted=true` : base;
    const items = await firstValueFrom(this.http.get<Product[]>(url));
    if (!includeDeleted) void this.db.setCache(this.cacheKey(), items);
    return items;
  }

  /** Last cached active list for instant/offline rendering (null if never fetched). */
  async cached(): Promise<Product[] | null> {
    return (await this.db.getCache<Product[]>(this.cacheKey()))?.data ?? null;
  }

  /** A single product from the cached list (for offline product-detail). */
  async cachedOne(id: number): Promise<Product | null> {
    const entry = await this.db.getCache<Product[]>(this.cacheKey());
    return entry?.data.find((p) => p.id === id) ?? null;
  }

  /** Optimistically replace a cached product (e.g. a stock change made offline). */
  async putCached(product: Product): Promise<void> {
    const entry = await this.db.getCache<Product[]>(this.cacheKey());
    if (!entry) return;
    await this.db.setCache(
      this.cacheKey(),
      entry.data.map((p) => (p.id === product.id ? product : p)),
    );
  }

  get(id: number): Promise<Product> {
    return firstValueFrom(this.http.get<Product>(`${this.kitchens.base()}/products/${id}`));
  }

  create(data: ProductInput): Promise<Product> {
    return firstValueFrom(this.http.post<Product>(`${this.kitchens.base()}/products`, data));
  }

  update(id: number, data: Partial<ProductInput>): Promise<Product> {
    return firstValueFrom(
      this.http.patch<Product>(`${this.kitchens.base()}/products/${id}`, data),
    );
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.kitchens.base()}/products/${id}`));
  }

  // ── stock ───────────────────────────────────────────────────────────────────

  addStock(productId: number, data: StockInput): Promise<Product> {
    return firstValueFrom(
      this.http.post<Product>(`${this.kitchens.base()}/products/${productId}/stock`, data),
    );
  }

  adjustStock(
    productId: number,
    stockId: number,
    data: { status_level?: number; remaining?: number; expected_updated_at?: string | null },
  ): Promise<Product> {
    return firstValueFrom(
      this.http.patch<Product>(
        `${this.kitchens.base()}/products/${productId}/stock/${stockId}`,
        data,
      ),
    );
  }

  removeStock(productId: number, stockId: number): Promise<Product> {
    return firstValueFrom(
      this.http.delete<Product>(`${this.kitchens.base()}/products/${productId}/stock/${stockId}`),
    );
  }
}
