import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PlanEntry, Product, ShoppingItem } from '../../models';
import { ShoppingService } from '../../services/shopping';
import { ProductsService } from '../../services/products';
import { KitchensService } from '../../services/kitchens';
import { UsersService } from '../../services/users';
import { LiveService } from '../../services/live';
import { SyncService } from '../../services/sync';

interface PlanRow {
  size: number;
  expiry: string;
}

@Component({
  selector: 'app-shopping',
  imports: [FormsModule, TranslatePipe],
  template: `
    <header class="px-4 pb-2 pt-3">
      <h1 class="text-largetitle font-bold">{{ 'shopping.title' | translate }}</h1>
    </header>

    @if (kitchens.canWrite()) {
    <form (ngSubmit)="add()" class="flex flex-wrap gap-2 px-4 pb-3">
      <input
        name="name"
        [(ngModel)]="newName"
        list="product-names"
        [placeholder]="'shopping.add' | translate"
        class="field min-w-0 flex-1"
      />
      <input name="amount" [(ngModel)]="newAmount" [placeholder]="'shopping.amount' | translate" class="field w-24 shrink-0" />
      <button type="submit" class="btn btn-primary shrink-0 px-4" [attr.aria-label]="'shopping.add' | translate">
        <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <datalist id="product-names">
        @for (p of products(); track p.id) {
          <option [value]="p.name"></option>
        }
      </datalist>
    </form>
    }

    @if (shopping.items().length === 0) {
      <div class="px-8 pt-16 text-center">
        <p class="text-[17px] font-medium text-label">{{ 'shopping.emptyTitle' | translate }}</p>
        <p class="mt-1 text-[15px] text-label-2">{{ 'shopping.emptyHint' | translate }}</p>
      </div>
    } @else {
      <ul class="ios-card ios-list mx-4">
        @for (item of shopping.items(); track item.id) {
          <li class="flex items-center gap-3 px-4 py-2.5">
            <button
              (click)="toggle(item)"
              [disabled]="!kitchens.canWrite()"
              class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-60"
              [class.border-tint]="item.state === 'inCart'"
              [class.bg-tint]="item.state === 'inCart'"
              [class.border-label-3]="item.state !== 'inCart'"
              [attr.aria-label]="(item.state === 'inCart' ? 'shopping.deselect' : 'shopping.packed') | translate"
            >
              @if (item.state === 'inCart') {
                <svg class="h-4 w-4 text-on-tint" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4 10-11" />
                </svg>
              }
            </button>

            @if (item.source === 'manual' && item.added_by != null) {
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background-color]="users.colorOf(item.added_by)"></span>
            }

            @if (isPending(item)) {
              <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" [title]="'shopping.syncing' | translate"></span>
            }

            <span
              class="flex-1 text-[17px]"
              [class.line-through]="item.state === 'inCart'"
              [class.text-label-3]="item.state === 'inCart'"
            >
              {{ item.display_name }}
              @if (item.amount_text) {
                <span class="text-[15px] text-label-2"> · {{ item.amount_text }}</span>
              }
            </span>

            @if (kitchens.canWrite()) {
              <button (click)="remove(item)" class="shrink-0 px-1.5 text-label-3" [attr.aria-label]="'shopping.remove' | translate">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            }
          </li>
        }
      </ul>
    }

    @if (shopping.cartCount() > 0 && kitchens.canWrite()) {
      <div class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mx-auto max-w-xl px-4 pb-2">
        @if (!completing()) {
          <button (click)="completing.set(true)" class="btn btn-primary w-full shadow-lg">
            {{ 'shopping.complete' | translate: { count: shopping.cartCount() } }}
          </button>
        } @else {
          <div class="ios-card space-y-2 p-3 shadow-lg">
            <input type="number" [(ngModel)]="totalPrice" [placeholder]="'shopping.totalPrice' | translate" class="field-2" />
            <div class="flex gap-2">
              <button (click)="completing.set(false)" class="btn btn-secondary flex-1">{{ 'shopping.cancel' | translate }}</button>
              <button (click)="complete()" [disabled]="busy()" class="btn btn-primary flex-1">{{ 'shopping.finish' | translate }}</button>
            </div>
          </div>
        }
      </div>
    }

    <!-- check-off sheet: quantity, then an expiry/size per package -->
    @if (coItem(); as item) {
      <button type="button" class="sheet-backdrop" [attr.aria-label]="'shopping.close' | translate" (click)="closeCheckoff()"></button>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grabber"></div>
        <h2 class="pb-1 pt-2 text-center text-title2 font-bold">{{ item.display_name }}</h2>

        @if (coStep() === 1) {
          <label class="mt-2 block text-[15px] font-medium text-label-2">
            {{ 'shopping.howManyPackages' | translate }}
            <input type="number" min="1" [(ngModel)]="coQty" class="field-2 mt-1.5" />
          </label>
          <div class="mt-4 flex gap-2">
            <button (click)="closeCheckoff()" class="btn btn-secondary flex-1">{{ 'shopping.cancel' | translate }}</button>
            <button (click)="step1Next()" class="btn btn-primary flex-1">
              {{ (needsStep2() ? 'shopping.next' : 'shopping.packed') | translate }}
            </button>
          </div>
        } @else {
          @if (coProduct()?.can_expire === 'expiry') {
            <div class="mt-3 flex items-end gap-2">
              <label class="flex-1 text-[15px] font-medium text-label-2">
                {{ 'shopping.allOn' | translate }}
                <input type="date" [(ngModel)]="coSameDate" class="field-2 mt-1.5" />
              </label>
              <button (click)="applySameDate()" class="btn btn-secondary px-4">{{ 'shopping.set' | translate }}</button>
            </div>
          }

          <ul class="mt-3 max-h-72 space-y-2 overflow-y-auto">
            @for (r of coRows; track $index; let i = $index) {
              <li class="flex items-center gap-2">
                <span class="w-6 shrink-0 text-[15px] tabular-nums text-label-3">{{ i + 1 }}.</span>
                @if (coProduct()?.tracking_type === 'counter') {
                  <input type="number" min="1" [(ngModel)]="r.size" [placeholder]="'shopping.size' | translate" class="field-2 w-20 px-2" />
                }
                @if (coProduct()?.can_expire === 'expiry') {
                  <input type="date" [(ngModel)]="r.expiry" class="field-2 min-w-0 flex-1 px-2" />
                }
              </li>
            }
          </ul>

          <div class="mt-4 flex gap-2">
            <button (click)="coStep.set(1)" class="btn btn-secondary flex-1">{{ 'shopping.back' | translate }}</button>
            <button (click)="confirmCheckoff()" class="btn btn-primary flex-1">{{ 'shopping.packed' | translate }}</button>
          </div>
        }
      </div>
    }
  `,
})
export class Shopping {
  protected shopping = inject(ShoppingService);
  protected users = inject(UsersService);
  protected kitchens = inject(KitchensService);
  private productsSvc = inject(ProductsService);
  private live = inject(LiveService);
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

  constructor() {
    void this.shopping.load();
    void this.productsSvc.cached().then((p) => p && this.products.set(p));
    void this.reloadProducts();

    // Live: the list itself refreshes globally (ShoppingService); the local
    // product definitions (autocomplete, check-off dialog) follow here.
    this.live.onChange(() => void this.reloadProducts());
  }

  private async reloadProducts(): Promise<void> {
    try {
      this.products.set(await this.productsSvc.list());
    } catch {
      // offline — keep cached/current definitions
    }
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
    if (!this.kitchens.canWrite()) return;
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
