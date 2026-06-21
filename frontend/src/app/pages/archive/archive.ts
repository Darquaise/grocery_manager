import { Component, inject, signal } from '@angular/core';

import { Trip } from '../../models';
import { ShoppingService } from '../../services/shopping';
import { UsersService } from '../../services/users';

@Component({
  selector: 'app-archive',
  template: `
    <header class="p-4">
      <h1 class="text-xl font-semibold">Archiv</h1>
    </header>

    @if (loading()) {
      <p class="px-4 text-sm opacity-60">Lädt…</p>
    } @else if (trips().length === 0) {
      <p class="px-4 text-sm opacity-60">Noch keine abgeschlossenen Einkäufe.</p>
    } @else {
      <ul class="space-y-3 px-4">
        @for (trip of trips(); track trip.id) {
          <li class="rounded-xl border border-gray-200 dark:border-neutral-800">
            <button (click)="toggle(trip.id)" class="flex w-full items-center justify-between gap-2 p-4 text-left">
              <span>
                <span class="block font-medium">{{ formatDate(trip.completed_at) }}</span>
                <span class="flex items-center gap-1.5 text-sm opacity-60">
                  @if (trip.completed_by != null) {
                    <span class="h-2 w-2 rounded-full" [style.background-color]="users.colorOf(trip.completed_by)"></span>
                    {{ userName(trip.completed_by) }} ·
                  }
                  {{ trip.items.length }} Artikel
                </span>
              </span>
              @if (trip.total_price != null) {
                <span class="shrink-0 font-semibold">{{ trip.total_price.toFixed(2) }} €</span>
              }
            </button>

            @if (expanded().has(trip.id)) {
              <ul class="border-t border-gray-100 px-4 py-2 text-sm dark:border-neutral-800">
                @for (item of trip.items; track $index) {
                  <li class="flex justify-between py-1">
                    <span>{{ item.display_name }}</span>
                    @if (item.amount_text) {
                      <span class="opacity-60">{{ item.amount_text }}</span>
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
