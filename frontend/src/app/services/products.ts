import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Product, ProductInput } from '../models';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);

  list(includeDeleted = false): Promise<Product[]> {
    const url = includeDeleted ? '/api/products?include_deleted=true' : '/api/products';
    return firstValueFrom(this.http.get<Product[]>(url));
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
