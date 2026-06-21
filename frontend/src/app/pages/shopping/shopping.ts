import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { PlanEntry, Product, ShoppingItem } from '../../models';
import { ShoppingService } from '../../services/shopping';
import { ProductsService } from '../../services/products';
import { UsersService } from '../../services/users';
import { ConnectivityService } from '../../services/connectivity';
import { SyncService } from '../../services/sync';

interface PlanRow {
  size: number;
  expiry: string;
}

@Component({
  selector: 'app-shopping',
  imports: [FormsModule],
  template: `
    <header class="p-4">
      <h1 class="text-xl font-semibold">Einkaufsliste</h1>
    </header>

    <form (ngSubmit)="add()" class="flex flex-wrap gap-2 px-4 pb-3">
      <input
        name="name"
        [(ngModel)]="newName"
        list="product-names"
        placeholder="Hinzufügen…"
        class="min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
      />
      <input
        name="amount"
        [(ngModel)]="newAmount"
        placeholder="Menge (optional)"
        class="w-32 rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
      />
      <button type="submit" class="rounded-lg bg-blue-600 px-4 font-medium text-white">+</button>
      <datalist id="product-names">
        @for (p of products(); track p.id) {
          <option [value]="p.name"></option>
        }
      </datalist>
    </form>

    @if (shopping.items().length === 0) {
      <p class="px-4 text-sm opacity-60">Die Liste ist leer.</p>
    } @else {
      <ul class="divide-y divide-gray-100 dark:divide-neutral-800">
        @for (item of shopping.items(); track item.id) {
          <li class="flex items-center gap-3 px-4 py-3">
            <button
              (click)="toggle(item)"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
              [class.border-blue-600]="item.state === 'inCart'"
              [class.bg-blue-600]="item.state === 'inCart'"
              [class.border-gray-300]="item.state !== 'inCart'"
              [class.dark:border-neutral-600]="item.state !== 'inCart'"
              [attr.aria-label]="item.state === 'inCart' ? 'Abwählen' : 'Eingepackt'"
            >
              @if (item.state === 'inCart') {
                <svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4 10-11" />
                </svg>
              }
            </button>

            @if (item.source === 'manual' && item.added_by != null) {
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background-color]="users.colorOf(item.added_by)"></span>
            }

            @if (isPending(item)) {
              <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="wird synchronisiert"></span>
            }

            <span class="flex-1" [class.line-through]="item.state === 'inCart'" [class.opacity-50]="item.state === 'inCart'">
              {{ item.display_name }}
              @if (item.amount_text) {
                <span class="text-sm opacity-60"> · {{ item.amount_text }}</span>
              }
            </span>

            <button (click)="remove(item)" class="shrink-0 px-2 text-lg opacity-40" aria-label="Entfernen">×</button>
          </li>
        }
      </ul>
    }

    @if (shopping.cartCount() > 0) {
      <div class="fixed inset-x-0 bottom-16 z-10 mx-auto max-w-xl px-4 pb-2">
        @if (!completing()) {
          <button (click)="completing.set(true)" class="w-full rounded-xl bg-emerald-600 py-3 font-medium text-white shadow-lg">
            Einkauf abschließen ({{ shopping.cartCount() }})
          </button>
        } @else {
          <div class="space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            <input
              type="number"
              [(ngModel)]="totalPrice"
              placeholder="Gesamtpreis (optional)"
              class="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
            />
            <div class="flex gap-2">
              <button (click)="completing.set(false)" class="flex-1 rounded-lg border border-gray-300 py-2 dark:border-neutral-700">Abbrechen</button>
              <button (click)="complete()" [disabled]="busy()" class="flex-1 rounded-lg bg-emerald-600 py-2 font-medium text-white disabled:opacity-50">Abschließen</button>
            </div>
          </div>
        }
      </div>
    }

    <!-- check-off dialog: quantity, then an expiry/size per package -->
    @if (coItem(); as item) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl dark:bg-neutral-900">
          <h2 class="text-lg font-semibold">{{ item.display_name }}</h2>

          @if (coStep() === 1) {
            <label class="mt-3 block text-sm">
              Wie viele Packungen?
              <input type="number" min="1" [(ngModel)]="coQty" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
            </label>
            <div class="mt-4 flex gap-2">
              <button (click)="closeCheckoff()" class="flex-1 rounded-lg border border-gray-300 py-2 dark:border-neutral-700">Abbrechen</button>
              <button (click)="step1Next()" class="flex-1 rounded-lg bg-blue-600 py-2 font-medium text-white">
                {{ needsStep2() ? 'Weiter' : 'Eingepackt' }}
              </button>
            </div>
          } @else {
            @if (coProduct()?.can_expire === 'expiry') {
              <div class="mt-3 flex items-end gap-2">
                <label class="flex-1 text-sm">
                  Alle auf
                  <input type="date" [(ngModel)]="coSameDate" class="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
                </label>
                <button (click)="applySameDate()" class="rounded-lg bg-gray-200 px-3 py-2 text-sm dark:bg-neutral-800">Setzen</button>
              </div>
            }

            <ul class="mt-3 max-h-72 space-y-2 overflow-y-auto">
              @for (r of coRows; track $index; let i = $index) {
                <li class="flex items-center gap-2">
                  <span class="w-6 shrink-0 text-sm opacity-50">{{ i + 1 }}.</span>
                  @if (coProduct()?.tracking_type === 'counter') {
                    <input type="number" min="1" [(ngModel)]="r.size" placeholder="Größe" class="w-20 rounded-lg border border-gray-300 bg-transparent px-2 py-2 dark:border-neutral-700" />
                  }
                  @if (coProduct()?.can_expire === 'expiry') {
                    <input type="date" [(ngModel)]="r.expiry" class="min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-2 py-2 dark:border-neutral-700" />
                  }
                </li>
              }
            </ul>

            <div class="mt-4 flex gap-2">
              <button (click)="coStep.set(1)" class="flex-1 rounded-lg border border-gray-300 py-2 dark:border-neutral-700">Zurück</button>
              <button (click)="confirmCheckoff()" class="flex-1 rounded-lg bg-blue-600 py-2 font-medium text-white">Eingepackt</button>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class Shopping implements OnDestroy {
  protected shopping = inject(ShoppingService);
  protected users = inject(UsersService);
  private productsSvc = inject(ProductsService);
  private connectivity = inject(ConnectivityService);
  private sync = inject(SyncService);
  private router = inject(Router);

  readonly products = signal<Product[]>([]);
  newName = '';
  newAmount = '';
  readonly completing = signal(false);
  readonly busy = signal(false);
  totalPrice: number | null = null;

  // check-off dialog state
  readonly coItem = signal<ShoppingItem | null>(null);
  readonly coProduct = signal<Product | null>(null);
  readonly coStep = signal<1 | 2>(1);
  coQty = 1;
  coSameDate = '';
  coRows: PlanRow[] = [];

  // Shared list: while this screen is open + online, refresh every 5 s so both
  // shoppers see what the other has already grabbed.
  private poll = setInterval(() => {
    if (document.visibilityState === 'visible' && this.connectivity.online()) {
      void this.shopping.load();
    }
  }, 5000);

  constructor() {
    void this.shopping.load();
    void this.productsSvc.cached().then((p) => p && this.products.set(p));
    void this.productsSvc
      .list()
      .then((p) => this.products.set(p))
      .catch(() => undefined);
  }

  ngOnDestroy(): void {
    clearInterval(this.poll);
  }

  /** Has unsynced changes (offline-added temp item or a queued toggle/remove)? */
  isPending(item: ShoppingItem): boolean {
    return item.id < 0 || this.sync.pendingShoppingIds().has(item.id);
  }

  async add(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    const match = this.products().find((p) => p.name.toLowerCase() === name.toLowerCase());
    await this.shopping.add(name, this.newAmount.trim() || undefined, match?.id);
    this.newName = '';
    this.newAmount = '';
  }

  toggle(item: ShoppingItem): void {
    if (item.state === 'inCart') {
      void this.shopping.setState(item, 'open');
      return;
    }
    const product =
      item.product_id != null ? this.products().find((p) => p.id === item.product_id) : undefined;
    if (!product) {
      // free / unknown product → no stock to record
      void this.shopping.setState(item, 'inCart');
      return;
    }
    this.startCheckoff(item, product);
  }

  remove(item: ShoppingItem): void {
    void this.shopping.remove(item);
  }

  // ── check-off dialog ──────────────────────────────────────────────────────

  private startCheckoff(item: ShoppingItem, product: Product): void {
    this.coItem.set(item);
    this.coProduct.set(product);
    this.coStep.set(1);
    this.coQty = 1;
    this.coSameDate = '';
    this.coRows = [];
  }

  needsStep2(): boolean {
    const p = this.coProduct();
    return !!p && (p.can_expire === 'expiry' || p.tracking_type === 'counter');
  }

  step1Next(): void {
    const p = this.coProduct();
    if (!p) return;
    const qty = Math.max(1, Math.round(this.coQty || 1));
    if (!this.needsStep2()) {
      void this.finish(Array.from({ length: qty }, () => ({}) as PlanEntry));
      return;
    }
    this.coRows = Array.from({ length: qty }, () => ({ size: p.package_size, expiry: '' }));
    this.coStep.set(2);
  }

  applySameDate(): void {
    this.coRows = this.coRows.map((r) => ({ ...r, expiry: this.coSameDate }));
  }

  confirmCheckoff(): void {
    const p = this.coProduct();
    if (!p) return;
    const plan: PlanEntry[] = this.coRows.map((r) => ({
      size: p.tracking_type === 'counter' ? Math.max(1, Math.round(r.size || 1)) : undefined,
      expiry_date: p.can_expire === 'expiry' ? r.expiry || null : undefined,
    }));
    void this.finish(plan);
  }

  closeCheckoff(): void {
    this.coItem.set(null);
    this.coProduct.set(null);
  }

  private async finish(plan: PlanEntry[]): Promise<void> {
    const item = this.coItem();
    if (item) await this.shopping.setState(item, 'inCart', plan);
    this.closeCheckoff();
  }

  async complete(): Promise<void> {
    this.busy.set(true);
    try {
      await this.shopping.complete(this.totalPrice);
      this.completing.set(false);
      this.totalPrice = null;
      await this.router.navigateByUrl('/archive');
    } catch {
      // Trip-Abschluss braucht Netz — offline bleibt die Liste einfach bestehen.
    } finally {
      this.busy.set(false);
    }
  }
}
