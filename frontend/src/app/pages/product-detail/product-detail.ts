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
    <header class="flex items-center gap-1 px-2 pb-1 pt-2">
      <button (click)="back()" class="flex items-center gap-0.5 pr-2 text-tint" aria-label="Zurück">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="m15 6-6 6 6 6" />
        </svg>
        <span class="text-[17px]">Zurück</span>
      </button>
      <h1 class="flex-1 truncate px-2 text-center text-headline font-semibold">
        {{ isNew() ? 'Neues Produkt' : form.name }}
      </h1>
      <span class="w-[76px] shrink-0"></span>
    </header>

    <!-- Stock (existing products only) -->
    @if (!isNew() && prod(); as p) {
      <section class="mx-4 mb-5">
        <h2 class="section-header">Bestand</h2>
        <div class="ios-card p-4">
          @if (p.tracking_type === 'status') {
            <!-- current package -->
            @if (p.stock.length === 0) {
              <p class="text-[15px] text-label-2">Kein Bestand.</p>
            } @else {
              <div class="flex gap-1 rounded-[10px] bg-fill p-1">
                @for (lvl of [0, 1, 2, 3, 4]; track lvl) {
                  <button
                    (click)="setLevel(lvl)"
                    class="flex-1 rounded-[8px] px-1 py-2 text-[11px] font-semibold leading-tight transition-colors"
                    [style.backgroundColor]="p.current_level === lvl ? levelColor(lvl) : 'transparent'"
                    [style.color]="p.current_level === lvl ? '#fff' : 'var(--c-label-2)'"
                  >
                    {{ status(lvl) }}
                  </button>
                }
              </div>
              @if (caption(p); as cap) {
                <p class="mt-2 text-center text-[13px] text-label-2">{{ cap }}</p>
              }
            }

            <!-- refill stock -->
            <div class="mt-4 flex items-center justify-between border-t border-separator pt-4">
              <span class="text-[15px] text-label-2">Nachfüllbestand</span>
              <div class="flex items-center gap-3">
                <button
                  (click)="removeRefill()"
                  [disabled]="(p.refill_count ?? 0) === 0"
                  class="flex h-9 w-9 items-center justify-center rounded-full bg-fill text-label active:bg-surface-press disabled:opacity-30"
                  aria-label="Nachfüllpaket entfernen"
                >
                  <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" d="M5 12h14" />
                  </svg>
                </button>
                <span class="min-w-[1.5ch] text-center font-rounded text-[19px] font-semibold tabular-nums">
                  {{ p.refill_count }}
                </span>
                <button
                  (click)="addPackage()"
                  class="flex h-9 w-9 items-center justify-center rounded-full bg-fill text-label active:bg-surface-press"
                  aria-label="Paket hinzufügen"
                >
                  <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>
          } @else {
            <!-- counter: total + stack -->
            <div class="mb-4 text-center">
              <span class="font-rounded text-[40px] font-bold leading-none tabular-nums">{{ p.total_units }}</span>
              <span class="ml-1 text-[15px] text-label-2">gesamt</span>
            </div>

            <ul class="space-y-2">
              @for (s of p.stock; track s.id; let first = $first) {
                <li class="flex items-center gap-3 rounded-[12px] bg-fill px-3 py-2">
                  @if (first) {
                    <button (click)="changeRemaining(-1)" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-label active:bg-surface-press" aria-label="Eins weniger">
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path stroke-linecap="round" d="M5 12h14" /></svg>
                    </button>
                  }
                  <div class="min-w-0 flex-1 text-center">
                    <span class="font-rounded font-semibold tabular-nums">{{ s.remaining }}</span>
                    <span class="text-[15px] text-label-2"> / {{ s.size }}</span>
                    @if (itemCaption(p, s); as cap) {
                      <span class="block text-[12px] text-label-2">{{ cap }}</span>
                    }
                  </div>
                  @if (first) {
                    <button (click)="changeRemaining(1)" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-label active:bg-surface-press" aria-label="Eins mehr">
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
                    </button>
                  } @else {
                    <span class="w-8 shrink-0"></span>
                  }
                </li>
              }
              @if (p.stock.length === 0) {
                <li class="text-[15px] text-label-2">Kein Bestand.</li>
              }
            </ul>

            <button (click)="addPackage()" class="btn btn-secondary mt-3 w-full">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
              Paket
            </button>
          }
        </div>
      </section>
    }

    <!-- Settings (collapsible) -->
    <section class="px-4 pb-8">
      @if (!isNew()) {
        <button
          (click)="settingsOpen.set(!settingsOpen())"
          class="section-header flex w-full items-center justify-between"
        >
          <span>Einstellungen</span>
          <svg class="h-4 w-4 transition-transform" [class.rotate-180]="settingsOpen()" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>
      } @else {
        <h2 class="section-header">Neues Produkt</h2>
      }

      @if (isNew() || settingsOpen()) {
        <div class="space-y-4">
          <label class="block">
            <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Name</span>
            <input [(ngModel)]="form.name" class="field" />
          </label>

          <label class="block">
            <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Kategorie</span>
            <select [(ngModel)]="form.category_id" class="field select">
              <option [ngValue]="null">Keine</option>
              @for (c of categories(); track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Lagerort</span>
            <select [(ngModel)]="form.location_id" class="field select">
              <option [ngValue]="null">Keiner</option>
              @for (l of locations(); track l.id) {
                <option [ngValue]="l.id">{{ l.name }}</option>
              }
            </select>
          </label>

          <label class="block" for="pd-package-size">
            <span class="mb-1 block px-1 text-[13px] font-medium text-label-2">Paketgröße</span>
            <span class="mb-1.5 block px-1 text-[12px] text-label-3">
              1 = einzeln, als Status (z.B. Milch). Größer = Zähler (Stück pro Packung).
            </span>
            <input id="pd-package-size" type="number" min="1" [(ngModel)]="form.package_size" class="field" />
          </label>

          <label class="block">
            <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Haltbarkeit</span>
            <select [(ngModel)]="form.can_expire" class="field select">
              <option value="none">Nein</option>
              <option value="expiry">Ablaufdatum</option>
              <option value="purchaseDate">Kaufdatum (Alter)</option>
            </select>
          </label>

          @if (formStatus()) {
            <label class="block" for="pd-reorder-level">
              <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Auf die Liste ab Status</span>
              <select id="pd-reorder-level" [(ngModel)]="form.reorder_status_level" class="field select">
                <option [ngValue]="null">Nie automatisch</option>
                <option [ngValue]="4">Voll</option>
                <option [ngValue]="3">Fast voll</option>
                <option [ngValue]="2">Mittel</option>
                <option [ngValue]="1">Knapp</option>
                <option [ngValue]="0">Leer</option>
              </select>
            </label>
            @if (form.reorder_status_level !== null) {
              <label class="block">
                <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">… und Nachfüllbestand höchstens</span>
                <input type="number" min="0" [(ngModel)]="form.reorder_refill_count" placeholder="0" class="field" />
              </label>
            }
          } @else {
            <label class="block">
              <span class="mb-1 block px-1 text-[13px] font-medium text-label-2">Auf die Liste ab Gesamtmenge</span>
              <span class="mb-1.5 block px-1 text-[12px] text-label-3">
                Bei dieser Stückzahl (oder weniger) landet das Produkt automatisch auf der Liste.
              </span>
              <input type="number" [(ngModel)]="form.reorder_total_units" placeholder="leer = nie automatisch" class="field" />
            </label>
          }

          <label class="block">
            <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Notiz</span>
            <textarea [(ngModel)]="form.notes" rows="2" class="field"></textarea>
          </label>

          @if (error()) {
            <p class="px-1 text-[15px] text-danger">{{ error() }}</p>
          }

          <button (click)="save()" [disabled]="saving()" class="btn btn-primary w-full">
            {{ isNew() ? 'Anlegen' : 'Speichern' }}
          </button>

          @if (!isNew()) {
            <button (click)="remove()" class="btn btn-danger w-full">Löschen</button>
          }
        </div>
      }
    </section>

    <!-- add-package sheet -->
    @if (adding() && prod(); as p) {
      <button type="button" class="sheet-backdrop" aria-label="Schließen" (click)="closeAdd()"></button>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grabber"></div>
        <h2 class="pb-2 pt-2 text-center text-title2 font-bold">Paket hinzufügen</h2>
        <div class="space-y-3">
          @if (p.tracking_type === 'counter') {
            <label class="block">
              <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Paketgröße</span>
              <input type="number" [(ngModel)]="addSize" class="field-2" />
            </label>
          }
          @if (p.can_expire === 'expiry') {
            <label class="block">
              <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Ablaufdatum</span>
              <input type="date" [(ngModel)]="addDate" class="field-2" />
            </label>
          } @else if (p.can_expire === 'purchaseDate') {
            <label class="block">
              <span class="mb-1.5 block px-1 text-[13px] font-medium text-label-2">Kaufdatum</span>
              <input type="date" [(ngModel)]="addDate" class="field-2" />
            </label>
          }
        </div>
        <div class="mt-4 flex gap-2">
          <button (click)="closeAdd()" class="btn btn-secondary flex-1">Abbrechen</button>
          <button (click)="confirmAdd()" class="btn btn-primary flex-1">Hinzufügen</button>
        </div>
      </div>
    }
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

  /** Colour for a chosen status level (mirrors the stock-meter gauge). */
  levelColor(lvl: number): string {
    if (lvl >= 3) return 'var(--c-good)';
    if (lvl === 2) return 'var(--c-warn)';
    return 'var(--c-danger)';
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
