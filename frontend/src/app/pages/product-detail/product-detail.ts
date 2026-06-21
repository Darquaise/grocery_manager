import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import {
  Category,
  ExpiryMode,
  Location,
  Product,
  ProductInput,
  StockInput,
  StockItem,
} from '../../models';
import { ProductsService } from '../../services/products';
import { CategoriesService } from '../../services/categories';
import { LocationsService } from '../../services/locations';
import { ConnectivityService } from '../../services/connectivity';
import { SyncService } from '../../services/sync';
import { deriveProduct, statusLabel, stockCaption, stockItemCaption } from '../../util/format';

interface FormModel {
  name: string;
  category_id: number | null;
  location_id: number | null;
  package_size: number;
  can_expire: ExpiryMode;
  reorder_status_level: number | null;
  reorder_refill_count: number | null;
  reorder_total_units: number | null;
  notes: string;
}

@Component({
  selector: 'app-product-detail',
  imports: [FormsModule],
  template: `
    <header class="flex items-center gap-2 p-4">
      <button (click)="back()" class="text-sm text-blue-600" aria-label="Zurück">‹ Zurück</button>
      <h1 class="flex-1 truncate text-center text-lg font-semibold">
        {{ isNew() ? 'Neues Produkt' : form.name }}
      </h1>
      <span class="w-14"></span>
    </header>

    <!-- Stock (existing products only) -->
    @if (!isNew() && prod(); as p) {
      <section class="mx-4 mb-4 rounded-xl border border-gray-200 p-4 dark:border-neutral-800">
        <p class="mb-3 text-xs font-semibold uppercase tracking-wide opacity-50">Bestand</p>

        @if (p.tracking_type === 'status') {
          <!-- current package -->
          @if (p.stock.length === 0) {
            <p class="mb-3 text-sm opacity-60">Kein Bestand.</p>
          } @else {
            <div class="grid grid-cols-5 gap-1">
              @for (lvl of [4, 3, 2, 1, 0]; track lvl) {
                <button
                  (click)="setLevel(lvl)"
                  class="rounded-lg border px-1 py-2 text-xs leading-tight"
                  [class.border-blue-600]="p.current_level === lvl"
                  [class.bg-blue-600]="p.current_level === lvl"
                  [class.text-white]="p.current_level === lvl"
                  [class.border-gray-300]="p.current_level !== lvl"
                  [class.dark:border-neutral-700]="p.current_level !== lvl"
                >
                  {{ status(lvl) }}
                </button>
              }
            </div>
            @if (caption(p); as cap) {
              <p class="mt-2 text-center text-xs opacity-50">{{ cap }}</p>
            }
          }

          <!-- refill stock -->
          <div class="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-neutral-800">
            <span class="text-sm opacity-70">Nachfüllbestand</span>
            <div class="flex items-center gap-3">
              <button
                (click)="removeRefill()"
                [disabled]="(p.refill_count ?? 0) === 0"
                class="h-9 w-9 rounded-full border border-gray-300 text-xl disabled:opacity-30 dark:border-neutral-700"
              >−</button>
              <span class="min-w-6 text-center text-lg font-semibold">{{ p.refill_count }}</span>
              <button (click)="addPackage()" class="h-9 w-9 rounded-full border border-gray-300 text-xl dark:border-neutral-700">+</button>
            </div>
          </div>
        } @else {
          <!-- counter: total + stack -->
          <div class="mb-3 text-center">
            <span class="text-3xl font-semibold">{{ p.total_units }}</span>
            <span class="ml-1 text-sm opacity-50">gesamt</span>
          </div>

          <ul class="space-y-2">
            @for (s of p.stock; track s.id; let first = $first) {
              <li class="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-neutral-800">
                @if (first) {
                  <button (click)="changeRemaining(-1)" class="h-8 w-8 shrink-0 rounded-full border border-gray-300 text-lg dark:border-neutral-700">−</button>
                }
                <div class="min-w-0 flex-1 text-center">
                  <span class="font-semibold">{{ s.remaining }}</span>
                  <span class="text-sm opacity-50"> / {{ s.size }}</span>
                  @if (itemCaption(p, s); as cap) {
                    <span class="block text-xs opacity-50">{{ cap }}</span>
                  }
                </div>
                @if (first) {
                  <button (click)="changeRemaining(1)" class="h-8 w-8 shrink-0 rounded-full border border-gray-300 text-lg dark:border-neutral-700">+</button>
                } @else {
                  <span class="w-8 shrink-0"></span>
                }
              </li>
            }
            @if (p.stock.length === 0) {
              <li class="text-sm opacity-60">Kein Bestand.</li>
            }
          </ul>

          <button (click)="addPackage()" class="mt-3 w-full rounded-lg border border-gray-300 py-2 text-sm dark:border-neutral-700">
            + Paket
          </button>
        }

        <!-- add-package panel -->
        @if (adding()) {
          <div class="mt-3 space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-neutral-800/50">
            @if (p.tracking_type === 'counter') {
              <label class="block text-sm">
                Paketgröße
                <input type="number" [(ngModel)]="addSize" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
              </label>
            }
            @if (p.can_expire === 'expiry') {
              <label class="block text-sm">
                Ablaufdatum
                <input type="date" [(ngModel)]="addDate" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
              </label>
            } @else if (p.can_expire === 'purchaseDate') {
              <label class="block text-sm">
                Kaufdatum
                <input type="date" [(ngModel)]="addDate" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
              </label>
            }
            <div class="flex gap-2">
              <button (click)="closeAdd()" class="flex-1 rounded-lg border border-gray-300 py-2 text-sm dark:border-neutral-700">Abbrechen</button>
              <button (click)="confirmAdd()" class="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white">Hinzufügen</button>
            </div>
          </div>
        }
      </section>
    }

    <!-- Settings (collapsible) -->
    <section class="px-4">
      @if (!isNew()) {
        <button
          (click)="settingsOpen.set(!settingsOpen())"
          class="flex w-full items-center justify-between py-2 text-xs font-semibold uppercase tracking-wide opacity-50"
        >
          <span>Einstellungen</span>
          <span>{{ settingsOpen() ? '▾' : '▸' }}</span>
        </button>
      }

      @if (isNew() || settingsOpen()) {
        <div class="space-y-3">
          <label class="block text-sm">
            Name
            <input [(ngModel)]="form.name" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
          </label>

          <label class="block text-sm">
            Kategorie
            <select [(ngModel)]="form.category_id" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700">
              <option [ngValue]="null">Keine</option>
              @for (c of categories(); track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>

          <label class="block text-sm">
            Lagerort
            <select [(ngModel)]="form.location_id" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700">
              <option [ngValue]="null">Keiner</option>
              @for (l of locations(); track l.id) {
                <option [ngValue]="l.id">{{ l.name }}</option>
              }
            </select>
          </label>

          <label class="block text-sm" for="pd-package-size">
            Paketgröße
            <span class="mt-0.5 block text-xs font-normal opacity-50">
              1 = einzeln, als Status (z.B. Milch). Größer = Zähler (Stück pro Packung).
            </span>
            <input id="pd-package-size" type="number" min="1" [(ngModel)]="form.package_size" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
          </label>

          <label class="block text-sm">
            Haltbarkeit
            <select [(ngModel)]="form.can_expire" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700">
              <option value="none">Nein</option>
              <option value="expiry">Ablaufdatum</option>
              <option value="purchaseDate">Kaufdatum (Alter)</option>
            </select>
          </label>

          @if (formStatus()) {
            <label class="block text-sm" for="pd-reorder-level">
              Auf die Liste ab Status
              <select id="pd-reorder-level" [(ngModel)]="form.reorder_status_level" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700">
                <option [ngValue]="null">Nie automatisch</option>
                <option [ngValue]="4">Voll</option>
                <option [ngValue]="3">Fast voll</option>
                <option [ngValue]="2">Mittel</option>
                <option [ngValue]="1">Knapp</option>
                <option [ngValue]="0">Leer</option>
              </select>
            </label>
            @if (form.reorder_status_level !== null) {
              <label class="block text-sm">
                … und Nachfüllbestand höchstens
                <input type="number" min="0" [(ngModel)]="form.reorder_refill_count" placeholder="0" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
              </label>
            }
          } @else {
            <label class="block text-sm">
              Auf die Liste ab Gesamtmenge
              <span class="mt-0.5 block text-xs font-normal opacity-50">
                Bei dieser Stückzahl (oder weniger) landet das Produkt automatisch auf der Liste.
              </span>
              <input type="number" [(ngModel)]="form.reorder_total_units" placeholder="leer = nie automatisch" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
            </label>
          }

          <label class="block text-sm">
            Notiz
            <textarea [(ngModel)]="form.notes" rows="2" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"></textarea>
          </label>

          @if (error()) {
            <p class="text-sm text-red-600">{{ error() }}</p>
          }

          <button (click)="save()" [disabled]="saving()" class="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white disabled:opacity-50">
            {{ isNew() ? 'Anlegen' : 'Speichern' }}
          </button>

          @if (!isNew()) {
            <button (click)="remove()" class="w-full rounded-lg border border-red-300 py-2.5 text-red-600 dark:border-red-900">
              Löschen
            </button>
          }
        </div>
      }
    </section>
  `,
})
export class ProductDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private products = inject(ProductsService);
  private categoriesSvc = inject(CategoriesService);
  private locationsSvc = inject(LocationsService);
  private connectivity = inject(ConnectivityService);
  private sync = inject(SyncService);

  readonly status = statusLabel;
  readonly caption = stockCaption;
  readonly itemCaption = stockItemCaption;

  private id = 0;
  readonly isNew = signal(true);
  readonly prod = signal<Product | null>(null);
  readonly categories = signal<Category[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly settingsOpen = signal(false);

  readonly adding = signal(false);
  addSize = 1;
  addDate = '';

  form: FormModel = {
    name: '',
    category_id: null,
    location_id: null,
    package_size: 1,
    can_expire: 'none',
    reorder_status_level: 1,
    reorder_refill_count: 0,
    reorder_total_units: null,
    notes: '',
  };

  formStatus(): boolean {
    return this.form.package_size <= 1;
  }

  constructor() {
    // Cache-first for the dropdowns so they work offline too.
    void this.categoriesSvc.cached().then((c) => c && this.categories.set(c));
    void this.locationsSvc.cached().then((l) => l && this.locations.set(l));
    void this.categoriesSvc.list().then((c) => this.categories.set(c)).catch(() => undefined);
    void this.locationsSvc.list().then((l) => this.locations.set(l)).catch(() => undefined);
    const param = this.route.snapshot.paramMap.get('id');
    if (param && param !== 'new') {
      this.id = Number(param);
      this.isNew.set(false);
      void this.loadProduct();
    }
  }

  private async loadProduct(): Promise<void> {
    const cached = await this.products.cachedOne(this.id);
    if (cached) this.applyProduct(cached);
    try {
      this.applyProduct(await this.products.get(this.id));
    } catch {
      // offline — keep the cached product if we had one
    }
  }

  private applyProduct(p: Product): void {
    this.prod.set(deriveProduct(p));
    this.form = {
      name: p.name,
      category_id: p.category_id,
      location_id: p.location_id,
      package_size: p.package_size,
      can_expire: p.can_expire,
      reorder_status_level: p.reorder_status_level,
      reorder_refill_count: p.reorder_refill_count,
      reorder_total_units: p.reorder_total_units,
      notes: p.notes ?? '',
    };
  }

  // ── stock changes (optimistic; queued + flushed, works offline) ───────────

  private commit(stock: StockItem[]): Product {
    const next = deriveProduct({ ...this.prod()!, stock });
    this.prod.set(next);
    void this.products.putCached(next);
    return next;
  }

  private base(item: StockItem): string | null {
    return this.connectivity.online() ? null : item.updated_at;
  }

  private async enqueueAdjust(
    item: StockItem,
    field: 'status_level' | 'remaining',
    value: number,
    p: Product,
  ): Promise<void> {
    await this.sync.enqueue({
      type: 'stock.adjust',
      payload: {
        productId: this.id,
        stockId: item.id,
        field,
        value,
        productName: p.name,
        trackingType: p.tracking_type,
      },
      baseUpdatedAt: this.base(item),
    });
    void this.sync.flush();
  }

  setLevel(level: number): void {
    const p = this.prod();
    if (!p || p.stock.length === 0) return;
    const current = p.stock[0];
    const stock =
      level <= 0
        ? p.stock.slice(1)
        : p.stock.map((s, i) => (i === 0 ? { ...s, status_level: level } : s));
    this.commit(stock);
    void this.enqueueAdjust(current, 'status_level', level, p);
  }

  changeRemaining(delta: number): void {
    const p = this.prod();
    if (!p || p.stock.length === 0) return;
    const top = p.stock[0];
    const next = Math.max(0, (top.remaining ?? 0) + delta);
    const stock =
      next <= 0
        ? p.stock.slice(1)
        : p.stock.map((s, i) => (i === 0 ? { ...s, remaining: next } : s));
    this.commit(stock);
    void this.enqueueAdjust(top, 'remaining', next, p);
  }

  async removeRefill(): Promise<void> {
    const p = this.prod();
    if (!p || p.stock.length < 2) return;
    const refill = p.stock[1]; // oldest refill (next in line after current)
    this.commit(p.stock.filter((s) => s.id !== refill.id));
    await this.sync.enqueue({
      type: 'stock.remove',
      payload: { productId: this.id, stockId: refill.id },
    });
    void this.sync.flush();
  }

  // ── adding a package ──────────────────────────────────────────────────────

  addPackage(): void {
    const p = this.prod();
    if (!p) return;
    if (p.can_expire !== 'none' || p.tracking_type === 'counter') {
      this.addSize = p.package_size;
      this.addDate = p.can_expire === 'purchaseDate' ? this.today() : '';
      this.adding.set(true);
    } else {
      void this.commitAdd({});
    }
  }

  confirmAdd(): void {
    const p = this.prod();
    if (!p) return;
    void this.commitAdd({
      size: this.addSize,
      expiry_date: p.can_expire === 'expiry' ? this.addDate || null : null,
      purchase_date: p.can_expire === 'purchaseDate' ? this.addDate || null : null,
    });
  }

  closeAdd(): void {
    this.adding.set(false);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async commitAdd(input: StockInput): Promise<void> {
    const p = this.prod();
    if (!p) return;
    const isStatus = p.tracking_type === 'status';
    const size = input.size ?? p.package_size;
    const now = new Date().toISOString();
    const temp: StockItem = {
      id: -Date.now(),
      product_id: this.id,
      expiry_date: p.can_expire === 'expiry' ? (input.expiry_date ?? null) : null,
      purchase_date: p.can_expire === 'purchaseDate' ? (input.purchase_date ?? this.today()) : null,
      status_level: isStatus ? 4 : null,
      remaining: isStatus ? null : size,
      size: isStatus ? null : size,
      created_at: now,
      updated_at: now,
    };
    this.commit([...p.stock, temp]);
    await this.sync.enqueue({
      type: 'stock.add',
      payload: {
        productId: this.id,
        expiry_date: temp.expiry_date,
        purchase_date: temp.purchase_date,
        size: isStatus ? null : size,
      },
    });
    void this.sync.flush();
    this.closeAdd();
  }

  // ── save / delete ─────────────────────────────────────────────────────────

  private buildPayload(): ProductInput {
    const isStatus = this.form.package_size <= 1;
    return {
      name: this.form.name.trim(),
      category_id: this.form.category_id,
      location_id: this.form.location_id,
      package_size: Math.max(1, Math.round(this.form.package_size || 1)),
      can_expire: this.form.can_expire,
      reorder_status_level: isStatus ? this.form.reorder_status_level : null,
      reorder_refill_count: isStatus
        ? this.form.reorder_status_level !== null
          ? (this.form.reorder_refill_count ?? 0)
          : null
        : null,
      reorder_total_units: isStatus ? null : this.form.reorder_total_units,
      notes: this.form.notes.trim() || null,
    };
  }

  async save(): Promise<void> {
    if (!this.form.name.trim()) {
      this.error.set('Name darf nicht leer sein.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    try {
      if (this.isNew()) {
        const created = await this.products.create(this.buildPayload());
        // Stay on the (now existing) product so stock can be added right away.
        this.id = created.id;
        this.isNew.set(false);
        this.settingsOpen.set(false);
        this.applyProduct(created);
        await this.router.navigate(['/products', created.id], { replaceUrl: true });
      } else {
        const updated = await this.products.update(this.id, this.buildPayload());
        this.applyProduct(updated);
        this.settingsOpen.set(false);
      }
    } catch {
      this.error.set('Speichern fehlgeschlagen.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    if (!confirm('Produkt wirklich löschen?')) return;
    await this.products.remove(this.id);
    await this.router.navigateByUrl('/');
  }

  back(): void {
    void this.router.navigateByUrl('/');
  }
}
