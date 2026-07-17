import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Product } from '../models';
import { statusLabel } from '../util/format';
import { LanguageService } from '../services/language';

/**
 * The glance value shown on the right of an inventory row: for status products
 * the current level word plus a "+N" refill chip; for counter products the
 * total as a prominent rounded numeral. Turns amber when low, red when empty.
 */
@Component({
  selector: 'app-stock-meter',
  template: `
    @if (isStatus()) {
      <span class="flex items-center gap-1.5">
        <span class="text-[15px] font-medium tabular-nums" [style.color]="labelColor()">
          {{ word() }}
        </span>
        @if (refill() > 0) {
          <span
            class="rounded-full bg-fill px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-label-2"
          >
            +{{ refill() }}
          </span>
        }
      </span>
    } @else {
      <span class="flex items-baseline gap-1">
        <span
          class="font-rounded text-[19px] font-semibold leading-none tabular-nums"
          [style.color]="labelColor()"
        >
          {{ total() }}
        </span>
        <span class="text-[12px] text-label-3">{{ 'inventory.units' | translate }}</span>
      </span>
    }
  `,
  imports: [TranslatePipe],
})
export class StockMeter {
  readonly product = input.required<Product>();
  private lang = inject(LanguageService);

  protected readonly isStatus = computed(() => this.product().tracking_type === 'status');
  protected readonly level = computed(() => this.product().current_level ?? 0);
  protected readonly refill = computed(() => this.product().refill_count ?? 0);
  protected readonly total = computed(() => this.product().total_units);
  // Depend on the active language so the status word re-translates on switch.
  protected readonly word = computed(() => (this.lang.current(), statusLabel(this.level())));

  protected readonly labelColor = computed(() => {
    const p = this.product();
    if (this.isStatus() && this.level() === 0) return 'var(--c-danger)';
    return p.is_low ? 'var(--c-warn)' : 'var(--c-label)';
  });
}
