import { Component, inject, signal } from '@angular/core';

import { Trip } from '../../models';
import { ShoppingService } from '../../services/shopping';
import { UsersService } from '../../services/users';

@Component({
  selector: 'app-archive',
  template: `
    <header class="px-4 pb-2 pt-3">
      <h1 class="text-largetitle font-bold">Archiv</h1>
    </header>

    @if (loading()) {
      <p class="px-4 text-[15px] text-label-2">Lädt…</p>
    } @else if (trips().length === 0) {
      <div class="px-8 pt-16 text-center">
        <p class="text-[17px] font-medium text-label">Noch nichts hier</p>
        <p class="mt-1 text-[15px] text-label-2">Abgeschlossene Einkäufe landen im Archiv.</p>
      </div>
    } @else {
      <ul class="space-y-3 px-4">
        @for (trip of trips(); track trip.id) {
          <li class="ios-card">
            <button (click)="toggle(trip.id)" class="flex w-full items-center justify-between gap-2 p-4 text-left active:bg-surface-press">
              <span>
                <span class="block text-[17px] font-medium">{{ formatDate(trip.completed_at) }}</span>
                <span class="mt-0.5 flex items-center gap-1.5 text-[13px] text-label-2">
                  @if (trip.completed_by != null) {
                    <span class="h-2 w-2 rounded-full" [style.background-color]="users.colorOf(trip.completed_by)"></span>
                    {{ userName(trip.completed_by) }} ·
                  }
                  {{ trip.items.length }} Artikel
                </span>
              </span>
              @if (trip.total_price != null) {
                <span class="shrink-0 font-rounded text-[17px] font-semibold tabular-nums">{{ trip.total_price.toFixed(2) }} €</span>
              }
            </button>

            @if (expanded().has(trip.id)) {
              <ul class="border-t border-separator px-4 py-2 text-[15px]">
                @for (item of trip.items; track $index) {
                  <li class="flex justify-between gap-3 py-1.5">
                    <span>{{ item.display_name }}</span>
                    @if (item.amount_text) {
                      <span class="text-label-2">{{ item.amount_text }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class Archive {
  private shopping = inject(ShoppingService);
  protected users = inject(UsersService);

  readonly trips = signal<Trip[]>([]);
  readonly loading = signal(true);
  readonly expanded = signal<Set<number>>(new Set());

  constructor() {
    void this.load();
    if (this.users.users().length === 0) void this.users.load();
  }

  private async load(): Promise<void> {
    try {
      this.trips.set(await this.shopping.listTrips());
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: number): void {
    const next = new Set(this.expanded());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.expanded.set(next);
  }

  userName(id: number): string {
    return this.users.users().find((u) => u.id === id)?.name ?? '';
  }

  formatDate(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
