import { Injectable, effect, inject, signal, untracked } from '@angular/core';

import { AuthService } from './auth';
import { KitchensService } from './kitchens';
import { ShoppingService } from './shopping';
import { SyncService } from './sync';
import { UsersService } from './users';

/**
 * Live updates for the active kitchen. Holds one SSE connection to
 * `/api/kitchens/:id/events`; the server pushes a content-free "something
 * changed" ping after every mutation (any member, any device).
 *
 * Everything funnels into the `rev` signal: SSE pings, reconnects, app focus
 * and coming back online all bump it (debounced). Consumers react by
 * re-fetching what they display — the root singletons (shopping list/badge,
 * member colours, kitchens/roles/invites) right here, open pages via their own
 * `effect` on `rev`. While the outbox still holds queued writes, bumps are
 * deferred until it drains so a server snapshot can never overwrite
 * not-yet-synced optimistic state.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private auth = inject(AuthService);
  private kitchens = inject(KitchensService);
  private sync = inject(SyncService);
  private shopping = inject(ShoppingService);
  private users = inject(UsersService);

  /** Bumped whenever the active kitchen's server data may have changed. */
  readonly rev = signal(0);

  private source: EventSource | null = null;
  private connectedKitchen: number | null = null;
  private everConnected = false;
  /** A ping arrived while local writes were pending — bump once they drain. */
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // (Re)connect whenever login state or the active kitchen changes.
    effect(() => {
      const kitchenId = this.auth.user() ? this.kitchens.activeId() : null;
      untracked(() => this.connect(kitchenId));
    });

    // Deferred pings fire once the outbox is empty again.
    effect(() => {
      if (this.sync.pending() === 0 && this.dirty) {
        this.dirty = false;
        untracked(() => this.bump());
      }
    });

    // Root singletons refresh on every bump; pages register via onChange().
    this.onChange(() => {
      void this.shopping.reloadFromServer();
      void this.users.load();
      // Also picks up role changes / removal / renames and re-checks my
      // pending invitations (join dialog).
      void this.kitchens.load();
    });

    // App focus & network return: refresh even with an empty outbox (the SSE
    // connection was likely dead while hidden — iOS suspends PWAs) and make
    // sure the stream is up again.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.wake();
    });
    window.addEventListener('online', () => this.wake());

    // Safety net: EventSource gives up permanently on some errors; as long as
    // the app is visible, keep trying. No data polling — this only repairs a
    // dead connection (a repair also bumps via `onopen`).
    setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        this.connectedKitchen != null &&
        (this.source === null || this.source.readyState === EventSource.CLOSED)
      ) {
        this.connect(this.connectedKitchen, true);
      }
    }, 30_000);
  }

  /** Run `fn` after every server-side change (skips the initial state).
   * Registers an effect in the caller's injection context, so page/component
   * subscriptions are cleaned up with their component. */
  onChange(fn: () => void): void {
    effect(() => {
      if (this.rev() === 0) return;
      untracked(fn);
    });
  }

  private connect(kitchenId: number | null, force = false): void {
    if (!force && kitchenId === this.connectedKitchen) return;
    this.source?.close();
    this.source = null;
    this.connectedKitchen = kitchenId;
    this.everConnected = false;
    if (kitchenId == null) return;

    const source = new EventSource(`/api/kitchens/${kitchenId}/events`);
    this.source = source;
    source.addEventListener('change', () => this.schedule());
    source.onopen = () => {
      // Catch-up after a reconnect — anything may have happened while away.
      if (this.everConnected) this.schedule();
      this.everConnected = true;
    };
    // onerror: EventSource retries by itself; the interval above repairs the
    // permanent-failure case.
  }

  private wake(): void {
    if (this.connectedKitchen == null) return;
    if (this.source === null || this.source.readyState === EventSource.CLOSED) {
      this.connect(this.connectedKitchen, true);
    }
    this.schedule();
  }

  /** Debounce bursts (my own flush, several quick taps elsewhere) into one
   * refresh; defer while local writes are still queued. */
  private schedule(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.sync.pending() > 0) {
        this.dirty = true;
        return;
      }
      this.bump();
    }, 300);
  }

  private bump(): void {
    this.rev.update((n) => n + 1);
  }
}
