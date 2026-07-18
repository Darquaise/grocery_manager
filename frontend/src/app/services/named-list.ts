import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ListItem, ListStore } from '../models';
import { OfflineDbService } from './offline-db';
import { KitchensService } from './kitchens';

/**
 * Shared implementation for the two managed name lists (categories and
 * storage locations): kitchen-scoped CRUD + offline read cache. Subclasses
 * only pick the endpoint/cache kind.
 */
export abstract class NamedListService<T extends ListItem> implements ListStore {
  protected http = inject(HttpClient);
  protected db = inject(OfflineDbService);
  protected kitchens = inject(KitchensService);

  /** API path segment and cache kind, e.g. "categories". */
  protected abstract readonly kind: string;

  private url(): string {
    return `${this.kitchens.base()}/${this.kind}`;
  }

  async list(): Promise<T[]> {
    const items = await firstValueFrom(this.http.get<T[]>(this.url()));
    void this.db.setCache(this.kitchens.cacheKey(this.kind), items);
    return items;
  }

  /** Last cached list for instant/offline rendering (null if never fetched). */
  async cached(): Promise<T[] | null> {
    return (await this.db.getCache<T[]>(this.kitchens.cacheKey(this.kind)))?.data ?? null;
  }

  create(name: string, sortOrder = 0): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.url(), { name, sort_order: sortOrder }));
  }

  update(id: number, data: { name?: string; sort_order?: number }): Promise<T> {
    return firstValueFrom(this.http.patch<T>(`${this.url()}/${id}`, data));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.url()}/${id}`));
  }
}
