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
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl dark:bg-neutral-900">
          <h2 class="text-lg font-semibold">Konflikt beim Synchronisieren</h2>
          <p class="mt-1 text-sm opacity-70">
            Diese Bestände wurden zwischenzeitlich auch woanders geändert. Welcher Wert soll gelten?
          </p>
          <ul class="mt-3 space-y-3">
            @for (c of sync.conflicts(); track c.stockId) {
              <li class="rounded-xl border border-gray-200 p-3 dark:border-neutral-700">
                <p class="font-medium">{{ c.productName }}</p>
                <div class="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <button
                    (click)="sync.resolveKeepMine(c)"
                    class="rounded-lg border border-blue-400 px-2 py-2 dark:border-blue-800"
                  >
                    <span class="block text-xs opacity-60">Deine</span>
                    <span class="font-semibold">{{ fmt(c, c.mineValue) }}</span>
                  </button>
                  <button
                    (click)="sync.resolveKeepTheirs(c)"
                    class="rounded-lg border border-gray-300 px-2 py-2 dark:border-neutral-700"
                  >
                    <span class="block text-xs opacity-60">Ihre</span>
                    <span class="font-semibold">{{ fmt(c, c.theirsValue) }}</span>
                  </button>
                </div>
              </li>
            }
          </ul>
        </div>
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
