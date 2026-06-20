import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Location } from '../models';

@Injectable({ providedIn: 'root' })
export class LocationsService {
  private http = inject(HttpClient);

  list(): Promise<Location[]> {
    return firstValueFrom(this.http.get<Location[]>('/api/locations'));
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
