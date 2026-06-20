import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Category } from '../models';

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private http = inject(HttpClient);

  list(): Promise<Category[]> {
    return firstValueFrom(this.http.get<Category[]>('/api/categories'));
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
