import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Category, ListStore } from '../models';
import { OfflineDbService } from './offline-db';

const CACHE_KEY = 'categories';

@Injectable({ providedIn: 'root' })
export class CategoriesService implements ListStore {
  private http = inject(HttpClient);
  private db = inject(OfflineDbService);

  async list(): Promise<Category[]> {
    const items = await firstValueFrom(this.http.get<Category[]>('/api/categories'));
    void this.db.setCache(CACHE_KEY, items);
    return items;
  }

  /** Last cached list for instant/offline rendering (null if never fetched). */
  async cached(): Promise<Category[] | null> {
    return (await this.db.getCache<Category[]>(CACHE_KEY))?.data ?? null;
  }

  create(name: string, sortOrder = 0): Promise<Category> {
    return firstValueFrom(
      this.http.post<Category>('/api/categories', { name, sort_order: sortOrder }),
    );
  }

  update(id: number, data: Partial<Pick<Category, 'name' | 'sort_order'>>): Promise<Category> {
    return firstValueFrom(this.http.patch<Category>(`/api/categories/${id}`, data));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/categories/${id}`));
  }
}
