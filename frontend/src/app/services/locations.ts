import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Location, ListStore } from '../models';
import { OfflineDbService } from './offline-db';

const CACHE_KEY = 'locations';

@Injectable({ providedIn: 'root' })
export class LocationsService implements ListStore {
  private http = inject(HttpClient);
  private db = inject(OfflineDbService);

  async list(): Promise<Location[]> {
    const items = await firstValueFrom(this.http.get<Location[]>('/api/locations'));
    void this.db.setCache(CACHE_KEY, items);
    return items;
  }

  /** Last cached list for instant/offline rendering (null if never fetched). */
  async cached(): Promise<Location[] | null> {
    return (await this.db.getCache<Location[]>(CACHE_KEY))?.data ?? null;
  }

  create(name: string, sortOrder = 0): Promise<Location> {
    return firstValueFrom(
      this.http.post<Location>('/api/locations', { name, sort_order: sortOrder }),
    );
  }

  update(id: number, data: Partial<Pick<Location, 'name' | 'sort_order'>>): Promise<Location> {
    return firstValueFrom(this.http.patch<Location>(`/api/locations/${id}`, data));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/locations/${id}`));
  }
}
