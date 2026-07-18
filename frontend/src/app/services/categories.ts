import { Injectable } from '@angular/core';

import { Category } from '../models';
import { NamedListService } from './named-list';

@Injectable({ providedIn: 'root' })
export class CategoriesService extends NamedListService<Category> {
  protected readonly kind = 'categories';
}
