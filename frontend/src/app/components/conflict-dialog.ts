import { Component, inject } from '@angular/core';

import { StockConflict, SyncService } from '../services/sync';
import { statusLabel } from '../util/format';

/**
 * Modal shown when an offline stock change collided with a concurrent change.
 * The user picks per package whose value should win. Self-hides when there are
 * no conflicts; rendered once in the app shell.
 */
@Component({
  selector: 'app-conflict-dialog',
  imports: [],
  template: `
    @if (sync.conflicts().length) {
      <div class="sheet-backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grabber"></div>
        <h2 class="pt-2 text-center text-title2 font-bold">Konflikt beim Synchronisieren</h2>
        <p class="mx-auto mt-1.5 max-w-xs text-center text-[15px] text-label-2">
          Diese Bestände wurden zwischenzeitlich auch woanders geändert. Welcher Wert soll gelten?
        </p>
        <ul class="mt-4 max-h-[55vh] space-y-3 overflow-y-auto">
          @for (c of sync.conflicts(); track c.stockId) {
            <li class="rounded-[14px] bg-fill p-3">
              <p class="text-[17px] font-medium">{{ c.productName }}</p>
              <div class="mt-2 grid grid-cols-2 gap-2">
                <button
                  (click)="sync.resolveKeepMine(c)"
                  class="rounded-[12px] border-2 border-tint bg-surface px-2 py-2.5 text-center active:bg-surface-press"
                >
                  <span class="block text-[12px] text-label-2">Deine</span>
                  <span class="text-[17px] font-semibold">{{ fmt(c, c.mineValue) }}</span>
                </button>
                <button
                  (click)="sync.resolveKeepTheirs(c)"
                  class="rounded-[12px] border border-separator bg-surface px-2 py-2.5 text-center active:bg-surface-press"
                >
                  <span class="block text-[12px] text-label-2">Ihre</span>
                  <span class="text-[17px] font-semibold">{{ fmt(c, c.theirsValue) }}</span>
                </button>
              </div>
            </li>
          }
        </ul>
      </div>
    }
  `,
})
export class ConflictDialog {
  protected sync = inject(SyncService);

  fmt(c: StockConflict, value: number): string {
    return c.field === 'status_level' ? statusLabel(value) : String(value);
  }
}
