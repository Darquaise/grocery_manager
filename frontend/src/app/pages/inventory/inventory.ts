import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Category, Location, Product } from '../../models';
import { ProductsService } from '../../services/products';
import { CategoriesService } from '../../services/categories';
import { LocationsService } from '../../services/locations';
import { captionTone, stockCaption } from '../../util/format';
import { StockMeter } from '../../components/stock-meter';

interface Group {
  name: string;
  products: Product[];
}

@Component({
  selector: 'app-inventory',
  imports: [FormsModule, RouterLink, StockMeter],
  template: `
    <header class="flex items-end justify-between gap-3 px-4 pb-2 pt-3">
      <h1 class="text-largetitle font-bold">Bestand</h1>
      <a
        routerLink="/products/new"
        class="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-fill text-tint active:bg-surface-press"
        aria-label="Produkt hinzufügen"
      >
        <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
        </svg>
      </a>
    </header>

    <div class="px-4 pb-2">
      <div class="relative">
        <svg
          class="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-label-3"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
        </svg>
        <input [(ngModel)]="search" placeholder="Suchen" class="field pl-9" />
      </div>
    </div>

    @if (locations().length > 0) {
      <div class="flex gap-2 overflow-x-auto px-4 pb-3 [-ms-overflow-style:none] [scrollbar-width:none]">
        <button
          (click)="locationFilter.set('')"
          class="shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors"
          [class.bg-tint]="locationFilter() === ''"
          [class.text-on-tint]="locationFilter() === ''"
          [class.bg-fill]="locationFilter() !== ''"
          [class.text-label]="locationFilter() !== ''"
        >
          Alle
        </button>
        @for (loc of locations(); track loc.id) {
          <button
            (click)="locationFilter.set(loc.id)"
            class="shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors"
            [class.bg-tint]="locationFilter() === loc.id"
            [class.text-on-tint]="locationFilter() === loc.id"
            [class.bg-fill]="locationFilter() !== loc.id"
            [class.text-label]="locationFilter() !== loc.id"
          >
            {{ loc.name }}
          </button>
        }
      </div>
    }

    @if (loading()) {
      <p class="px-4 text-[15px] text-label-2">Lädt…</p>
    } @else if (groups().length === 0) {
      <div class="px-8 pt-16 text-center">
        <p class="text-[17px] font-medium text-label">Nichts gefunden</p>
        <p class="mt-1 text-[15px] text-label-2">
          Lege oben rechts mit „+“ dein erstes Produkt an.
        </p>
      </div>
    } @else {
      @for (group of groups(); track group.name) {
        <section class="mb-5">
          <h2 class="section-header">{{ group.name }}</h2>
          <ul class="ios-card ios-list mx-4">
            @for (p of group.products; track p.id) {
              <li>
                <a
                  [routerLink]="['/products', p.id]"
                  class="flex items-center gap-3 px-4 py-2.5 active:bg-surface-press"
                >
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-2">
                      <span class="truncate text-[17px]">{{ p.name }}</span>
                      @if (locationName(p.location_id); as loc) {
                        <span class="shrink-0 rounded-md bg-fill px-1.5 py-0.5 text-[11px] font-medium text-label-2">
                          {{ loc }}
                        </span>
                      }
                    </span>
                    @if (caption(p); as cap) {
                      <span class="block text-[13px]" [style.color]="captionColor(p)">{{ cap }}</span>
                    }
                  </span>
                  <app-stock-meter [product]="p" />
                  <svg class="h-4 w-4 shrink-0 text-label-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
                  </svg>
                </a>
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
})
export class Inventory {
  private products = inject(ProductsService);
  private categories = inject(CategoriesService);
  private locationsSvc = inject(LocationsService);

  readonly caption = stockCaption;

  captionColor(p: Product): string {
    const tone = captionTone(p);
    return tone === 'danger' ? 'var(--c-danger)' : tone === 'warn' ? 'var(--c-warn)' : 'var(--c-label-2)';
  }

  private items = signal<Product[]>([]);
  private cats = signal<Category[]>([]);
  private locs = signal<Location[]>([]);
  readonly loading = signal(true);

  search = signal('');
  locationFilter = signal<number | ''>('');

  readonly locations = computed(() => this.locs());

  private readonly locById = computed(() => new Map(this.locs().map((l) => [l.id, l.name])));

  locationName(id: number | null): string | null {
    return id == null ? null : (this.locById().get(id) ?? null);
  }

  readonly groups = computed<Group[]>(() => {
    const q = this.search().trim().toLowerCase();
    const loc = this.locationFilter();
    const filtered = this.items().filter(
      (p) => (!q || p.name.toLowerCase().includes(q)) && (loc === '' || p.location_id === loc),
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
    // 1) Instant render from cache (offline-friendly, stale-while-revalidate).
    const [cp, cc, cl] = await Promise.all([
      this.products.cached(),
      this.categories.cached(),
      this.locationsSvc.cached(),
    ]);
    if (cp) this.items.set(cp);
    if (cc) this.cats.set(cc);
    if (cl) this.locs.set(cl);
    if (cp || cc || cl) this.loading.set(false);

    // 2) Revalidate from the server; offline we just keep the cache.
    try {
      const [products, categories, locations] = await Promise.all([
        this.products.list(),
        this.categories.list(),
        this.locationsSvc.list(),
      ]);
      this.items.set(products);
      this.cats.set(categories);
      this.locs.set(locations);
    } catch {
      // offline / server unreachable — cached data stays on screen
    } finally {
      this.loading.set(false);
    }
  }
}
