import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { Category, Location, Product, ProductInput, TrackingType } from '../../models';
import { ProductsService } from '../../services/products';
import { CategoriesService } from '../../services/categories';
import { LocationsService } from '../../services/locations';
import { statusLabel } from '../../util/format';

interface FormModel {
  name: string;
  category_id: number | null;
  location_id: number | null;
  tracking_type: TrackingType;
  current_value: number;
  min_value: number | null;
  step: number | null;
  full_value: number | null;
  unit: string;
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

    <!-- Stock controls (existing products only) -->
    @if (!isNew()) {
      <section class="mx-4 mb-4 rounded-xl border border-gray-200 p-4 dark:border-neutral-800">
        <p class="mb-3 text-xs font-semibold uppercase tracking-wide opacity-50">Bestand</p>

        @switch (form.tracking_type) {
          @case ('status') {
            <div class="grid grid-cols-5 gap-1">
              @for (lvl of [4, 3, 2, 1, 0]; track lvl) {
                <button
                  (click)="setValue(lvl)"
                  class="rounded-lg border px-1 py-2 text-xs leading-tight"
                  [class.border-blue-600]="form.current_value === lvl"
                  [class.bg-blue-600]="form.current_value === lvl"
                  [class.text-white]="form.current_value === lvl"
                  [class.border-gray-300]="form.current_value !== lvl"
                  [class.dark:border-neutral-700]="form.current_value !== lvl"
                >
                  {{ status(lvl) }}
                </button>
              }
            </div>
          }
          @default {
            <div class="flex items-center justify-center gap-4">
              <button (click)="adjustBy(-stepSize())" class="h-12 w-12 rounded-full border border-gray-300 text-2xl dark:border-neutral-700">−</button>
              <div class="min-w-24 text-center text-2xl font-semibold">
                {{ form.current_value }}<span class="ml-1 text-base opacity-50">{{ form.unit }}</span>
              </div>
              <button (click)="adjustBy(stepSize())" class="h-12 w-12 rounded-full border border-gray-300 text-2xl dark:border-neutral-700">+</button>
            </div>
            <div class="mt-3 flex gap-2">
              <input
                type="number"
                [(ngModel)]="exactValue"
                placeholder="Exakter Wert"
                class="flex-1 rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
              />
              <button (click)="applyExact()" class="rounded-lg bg-gray-200 px-4 dark:bg-neutral-800">Setzen</button>
            </div>
          }
        }

        @if (form.tracking_type !== 'status' && form.full_value != null) {
          <button (click)="setValue(form.full_value!)" class="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white">
            Voll auffüllen ({{ form.full_value }}{{ form.unit ? ' ' + form.unit : '' }})
          </button>
        }
      </section>
    }

    <!-- Edit form -->
    <section class="space-y-3 px-4">
      <p class="text-xs font-semibold uppercase tracking-wide opacity-50">Eigenschaften</p>

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

      <label class="block text-sm">
        Typ
        <select [(ngModel)]="form.tracking_type" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700">
          <option value="status">Status (Voll/Knapp/Leer)</option>
          <option value="counter">Zähler</option>
          <option value="amount">Menge</option>
        </select>
      </label>

      @if (isNew()) {
        <label class="block text-sm">
          Anfangsbestand
          @if (form.tracking_type === 'status') {
            <select [(ngModel)]="form.current_value" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700">
              <option [ngValue]="4">Voll</option>
              <option [ngValue]="3">Fast voll</option>
              <option [ngValue]="2">Mittel</option>
              <option [ngValue]="1">Knapp</option>
              <option [ngValue]="0">Leer</option>
            </select>
          } @else {
            <input type="number" [(ngModel)]="form.current_value" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
          }
        </label>
      }

      <label class="block text-sm">
        Auf die Einkaufsliste ab
        <span class="mt-0.5 block text-xs font-normal opacity-50">
          Bei diesem Bestand (oder weniger) landet das Produkt automatisch auf der Liste.
        </span>
        @if (form.tracking_type === 'status') {
          <select [(ngModel)]="form.min_value" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700">
            <option [ngValue]="null">Nie automatisch</option>
            <option [ngValue]="3">Fast voll</option>
            <option [ngValue]="2">Mittel</option>
            <option [ngValue]="1">Knapp</option>
            <option [ngValue]="0">Leer</option>
          </select>
        } @else {
          <input type="number" [(ngModel)]="form.min_value" placeholder="leer = nie automatisch" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
        }
      </label>

      @if (form.tracking_type !== 'status') {
        <label class="block text-sm">
          Schrittgröße (±-Buttons)
          <input type="number" [(ngModel)]="form.step" placeholder="Standard 1" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
        </label>
        <label class="block text-sm">
          „Voll"-Wert (nach Kauf)
          <input type="number" [(ngModel)]="form.full_value" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
        </label>
      }

      @if (form.tracking_type === 'amount') {
        <label class="block text-sm">
          Einheit
          <input [(ngModel)]="form.unit" placeholder="g / ml / Stück" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
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
    </section>
  `,
})
export class ProductDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private products = inject(ProductsService);
  private categoriesSvc = inject(CategoriesService);
  private locationsSvc = inject(LocationsService);

  readonly status = statusLabel;

  private id: number | null = null;
  readonly isNew = signal(true);
  readonly categories = signal<Category[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly saving = signal(false);
  readonly error = signal('');
  exactValue: number | null = null;

  form: FormModel = {
    name: '',
    category_id: null,
    location_id: null,
    tracking_type: 'status',
    current_value: 4,
    min_value: 1,
    step: null,
    full_value: null,
    unit: '',
    notes: '',
  };

  readonly stepSize = computed(() => this.form.step && this.form.step > 0 ? this.form.step : 1);

  constructor() {
    void this.categoriesSvc.list().then((c) => this.categories.set(c));
    void this.locationsSvc.list().then((l) => this.locations.set(l));
    const param = this.route.snapshot.paramMap.get('id');
    if (param && param !== 'new') {
      this.id = Number(param);
      this.isNew.set(false);
      void this.loadProduct();
    }
  }

  private async loadProduct(): Promise<void> {
    const p = await this.products.get(this.id!);
    this.applyProduct(p);
  }

  private applyProduct(p: Product): void {
    this.form = {
      name: p.name,
      category_id: p.category_id,
      location_id: p.location_id,
      tracking_type: p.tracking_type,
      current_value: p.current_value,
      min_value: p.min_value,
      step: p.step,
      full_value: p.full_value,
      unit: p.unit ?? '',
      notes: p.notes ?? '',
    };
  }

  // ── stock adjustments (existing products) ─────────────────────────────────

  async setValue(value: number): Promise<void> {
    const updated = await this.products.adjust(this.id!, value);
    this.form.current_value = updated.current_value;
  }

  adjustBy(delta: number): void {
    const next = Math.max(0, this.form.current_value + delta);
    void this.setValue(next);
  }

  applyExact(): void {
    if (this.exactValue == null || Number.isNaN(this.exactValue)) return;
    void this.setValue(Math.max(0, this.exactValue));
    this.exactValue = null;
  }

  // ── save / delete ─────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (!this.form.name.trim()) {
      this.error.set('Name darf nicht leer sein.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const payload: ProductInput = {
      name: this.form.name.trim(),
      category_id: this.form.category_id,
      location_id: this.form.location_id,
      tracking_type: this.form.tracking_type,
      current_value: this.form.current_value,
      min_value: this.form.min_value,
      step: this.form.tracking_type === 'status' ? null : this.form.step,
      full_value: this.form.tracking_type === 'status' ? null : this.form.full_value,
      unit: this.form.tracking_type === 'amount' ? this.form.unit.trim() || null : null,
      notes: this.form.notes.trim() || null,
    };
    try {
      if (this.isNew()) await this.products.create(payload);
      else await this.products.update(this.id!, payload);
      await this.router.navigateByUrl('/');
    } catch {
      this.error.set('Speichern fehlgeschlagen.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    if (!confirm('Produkt wirklich löschen?')) return;
    await this.products.remove(this.id!);
    await this.router.navigateByUrl('/');
  }

  back(): void {
    void this.router.navigateByUrl('/');
  }
}
