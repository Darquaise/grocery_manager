import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Kitchen, KitchenInvite, KitchenMember, KitchenRole, PendingInvite } from '../models';

const KITCHENS_KEY = 'grocery.kitchens';
const ACTIVE_KEY = 'grocery.activeKitchen';

/**
 * My kitchens + the currently active one. Both are mirrored to localStorage so
 * the app (and the kitchen-scoped API URLs / cache keys) work offline right
 * from startup. All domain services derive their endpoints from `base()`.
 */
@Injectable({ providedIn: 'root' })
export class KitchensService {
  private http = inject(HttpClient);
  private injector = inject(Injector);

  readonly kitchens = signal<Kitchen[]>(readJson<Kitchen[]>(KITCHENS_KEY) ?? []);
  readonly activeId = signal<number | null>(readJson<number>(ACTIVE_KEY));
  /** Open invitations addressed to me — drives the join dialog. */
  readonly myInvites = signal<KitchenInvite[]>([]);

  readonly active = computed<Kitchen | null>(
    () => this.kitchens().find((k) => k.id === this.activeId()) ?? null,
  );
  /** Role gates for the active kitchen (no kitchen = everything off). */
  readonly canWrite = computed(() => {
    const role = this.active()?.my_role;
    return role === 'write' || role === 'admin';
  });
  readonly canManage = computed(() => this.active()?.my_role === 'admin');
  readonly isOwner = computed(() => this.active()?.is_owner ?? false);

  /** The API prefix of the active kitchen. Throws when none is selected —
   * routes that need one sit behind the kitchen guard. */
  base(): string {
    const id = this.activeId();
    if (id == null) throw new Error('no active kitchen');
    return `/api/kitchens/${id}`;
  }

  /** Cache-key prefix so offline data of different kitchens never mixes. */
  cacheKey(kind: string): string {
    return `${this.activeId()}:${kind}`;
  }

  /** Fetch my kitchens and reconcile the active selection. Offline keeps the
   * localStorage mirror. Returns the (possibly cached) list. */
  async load(): Promise<Kitchen[]> {
    void this.loadMyInvites(); // keep the join dialog in sync alongside
    try {
      const kitchens = await firstValueFrom(this.http.get<Kitchen[]>('/api/kitchens'));
      this.setKitchens(kitchens);
    } catch {
      // offline / unreachable — keep the mirror
    }
    return this.kitchens();
  }

  async create(name: string): Promise<Kitchen> {
    const kitchen = await firstValueFrom(this.http.post<Kitchen>('/api/kitchens', { name }));
    this.setKitchens([...this.kitchens(), kitchen]);
    if (this.activeId() == null) this.select(kitchen.id);
    return kitchen;
  }

  async rename(name: string): Promise<void> {
    const kitchen = await firstValueFrom(
      this.http.patch<Kitchen>(this.base(), { name }),
    );
    this.setKitchens(this.kitchens().map((k) => (k.id === kitchen.id ? kitchen : k)));
  }

  /** Switch the active kitchen and reload the kitchen-scoped data. */
  select(id: number): void {
    if (this.activeId() === id) return;
    this.activeId.set(id);
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(id));
    void this.reloadScopedData();
  }

  /** Delete the active kitchen with everything in it (owner only). */
  async deleteKitchen(): Promise<void> {
    const id = this.activeId();
    await firstValueFrom(this.http.delete<void>(this.base()));
    this.activeId.set(null);
    localStorage.removeItem(ACTIVE_KEY);
    this.setKitchens(this.kitchens().filter((k) => k.id !== id));
  }

  /** Drop all kitchen state (logout / account switch). Also resets the
   * kitchen-scoped singletons so no data of the previous account lingers. */
  clear(): void {
    this.kitchens.set([]);
    this.activeId.set(null);
    this.myInvites.set([]);
    localStorage.removeItem(KITCHENS_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    void this.reloadScopedData();
  }

  // ── members ───────────────────────────────────────────────────────────────

  members(): Promise<KitchenMember[]> {
    return firstValueFrom(this.http.get<KitchenMember[]>(`${this.base()}/members`));
  }

  updateRole(userId: number, role: KitchenRole): Promise<KitchenMember[]> {
    return firstValueFrom(
      this.http.patch<KitchenMember[]>(`${this.base()}/members/${userId}`, { role }),
    );
  }

  removeMember(userId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base()}/members/${userId}`));
  }

  /** Leave the active kitchen (not possible for the owner). */
  async leave(myUserId: number): Promise<void> {
    const id = this.activeId();
    await this.removeMember(myUserId);
    this.setKitchens(this.kitchens().filter((k) => k.id !== id));
    this.activeId.set(null);
    localStorage.removeItem(ACTIVE_KEY);
    const next = this.kitchens()[0];
    if (next) this.select(next.id);
  }

  async transferOwnership(userId: number): Promise<KitchenMember[]> {
    const members = await firstValueFrom(
      this.http.post<KitchenMember[]>(`${this.base()}/transfer`, { user_id: userId }),
    );
    await this.load(); // is_owner / my_role changed
    return members;
  }

  // ── invitations ───────────────────────────────────────────────────────────

  /** Invite a user by name into the active kitchen (pending until accepted). */
  invite(name: string, role: KitchenRole): Promise<PendingInvite[]> {
    return firstValueFrom(
      this.http.post<PendingInvite[]>(`${this.base()}/invites`, { name, role }),
    );
  }

  pendingInvites(): Promise<PendingInvite[]> {
    return firstValueFrom(this.http.get<PendingInvite[]>(`${this.base()}/invites`));
  }

  revokeInvite(inviteId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base()}/invites/${inviteId}`));
  }

  /** Refresh the invitations addressed to me (join dialog). Offline: keep. */
  async loadMyInvites(): Promise<void> {
    try {
      this.myInvites.set(
        await firstValueFrom(this.http.get<KitchenInvite[]>('/api/kitchen-invites')),
      );
    } catch {
      // offline / unreachable — leave as-is
    }
  }

  /** Accept an invitation: become a member and make that kitchen active. */
  async acceptInvite(invite: KitchenInvite): Promise<void> {
    const kitchen = await firstValueFrom(
      this.http.post<Kitchen>(`/api/kitchen-invites/${invite.id}/accept`, {}),
    );
    this.myInvites.set(this.myInvites().filter((i) => i.id !== invite.id));
    this.setKitchens([...this.kitchens().filter((k) => k.id !== kitchen.id), kitchen]);
    this.select(kitchen.id);
  }

  async declineInvite(invite: KitchenInvite): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`/api/kitchen-invites/${invite.id}`));
    this.myInvites.set(this.myInvites().filter((i) => i.id !== invite.id));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private setKitchens(kitchens: Kitchen[]): void {
    this.kitchens.set(kitchens);
    localStorage.setItem(KITCHENS_KEY, JSON.stringify(kitchens));
    const active = this.activeId();
    if (active != null && !kitchens.some((k) => k.id === active)) {
      // Active kitchen vanished (left / removed) — fall back to the first one.
      this.activeId.set(null);
      localStorage.removeItem(ACTIVE_KEY);
    }
    if (this.activeId() == null && kitchens.length > 0) this.select(kitchens[0].id);
  }

  /** Refresh the kitchen-scoped singletons after a switch. Resolved lazily via
   * the injector to avoid a DI cycle (they inject this service for URLs). */
  private async reloadScopedData(): Promise<void> {
    const [{ ShoppingService }, { UsersService }] = await Promise.all([
      import('./shopping'),
      import('./users'),
    ]);
    void this.injector.get(ShoppingService).switchKitchen();
    void this.injector.get(UsersService).load();
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
