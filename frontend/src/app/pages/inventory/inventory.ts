import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Category, Product } from '../../models';
import { ProductsService } from '../../services/products';
import { CategoriesService } from '../../services/categories';
import { formatValue, isLow } from '../../util/format';

interface Group {
  name: string;
  products: Product[];
}

@Component({
  selector: 'app-inventory',
  imports: [FormsModule, RouterLink],
  template: `
    <header class="space-y-3 p-4">
      <h1 class="text-xl font-semibold">Bestand</h1>
      <input
        [(ngModel)]="search"
        placeholder="Suchen…"
        class="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
      />
      @if (locations().length > 0) {
        <select
          [(ngModel)]="locationFilter"
          class="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
        >
          <option value="">Alle Lagerorte</option>
          @for (loc of locations(); track loc) {
            <option [value]="loc">{{ loc }}</option>
          }
        </select>
      }
    </header>

    @if (loading()) {
      <p class="px-4 text-sm opacity-60">Lädt…</p>
    } @else if (groups().length === 0) {
      <p class="px-4 text-sm opacity-60">Keine Produkte gefunden.</p>
    } @else {
      @for (group of groups(); track group.name) {
        <section class="mb-4">
          <h2 class="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide opacity-50">
            {{ group.name }}
          </h2>
          <ul class="divide-y divide-gray-100 dark:divide-neutral-800">
            @for (p of group.products; track p.id) {
              <li>
                <a
                  [routerLink]="['/products', p.id]"
                  class="flex items-center justify-between gap-3 px-4 py-3 active:bg-gray-100 dark:active:bg-neutral-900"
                >
                  <span class="flex items-center gap-2">
                    @if (isLow(p)) {
                      <span class="h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
                    }
                    <span>{{ p.name }}</span>
                    @if (p.location) {
                      <span class="text-xs opacity-40">{{ p.location }}</span>
                    }
                  </span>
                  <span
                    class="shrink-0 text-sm"
                    [class.text-amber-600]="isLow(p)"
                    [class.opacity-60]="!isLow(p)"
                  >
                    {{ value(p) }}
                  </span>
                </a>
              </li>
            }
          </ul>
        </section>
      }
    }

    <a
      routerLink="/products/new"
      class="fixed bottom-24 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-3xl leading-none text-white shadow-lg"
      aria-label="Produkt hinzufügen"
    >
      +
    </a>
  `,
})
export class Inventory {
  private products = inject(ProductsService);
  private categories = inject(CategoriesService);

  readonly value = formatValue;
  readonly isLow = isLow;

  private items = signal<Product[]>([]);
  private cats = signal<Category[]>([]);
  readonly loading = signal(true);

  search = signal('');
  locationFilter = signal('');

  readonly locations = computed(() =>
    [...new Set(this.items().map((p) => p.location).filter((l): l is string => !!l))].sort(),
  );

  readonly groups = computed<Group[]>(() => {
    const q = this.search().trim().toLowerCase();
    const loc = this.locationFilter();
    const filtered = this.items().filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) && (!loc || (p.location ?? '') === loc),
    );

    const byCategory = new Map<number, Product[]>();
    const noCategory: Product[] = [];
    for (const p of filtered) {
      if (p.category_id == null) {
        noCategory.push(p);
        continue;
      }
      const arr = byCategory.get(p.category_id);
      if (arr) arr.push(p);
      else byCategory.set(p.category_id, [p]);
    }

    const groups: Group[] = [];
    for (const c of this.cats()) {
      const products = byCategory.get(c.id);
      if (products?.length) groups.push({ name: c.name, products });
    }
    if (noCategory.length) groups.push({ name: 'Ohne Kategorie', products: noCategory });
    return groups;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [products, categories] = await Promise.all([
        this.products.list(),
        this.categories.list(),
      ]);
      this.items.set(products);
      this.cats.set(categories);
    } finally {
      this.loading.set(false);
    }
  }
}
