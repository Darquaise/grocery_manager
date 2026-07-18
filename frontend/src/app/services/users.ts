import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { KitchenMember, User } from '../models';
import { KitchensService } from './kitchens';

@Injectable({ providedIn: 'root' })
export class UsersService {
  private http = inject(HttpClient);
  private kitchens = inject(KitchensService);

  /** Members of the active kitchen, cached for colour/name lookups across the UI. */
  readonly members = signal<KitchenMember[]>([]);

  async load(): Promise<KitchenMember[]> {
    if (this.kitchens.activeId() == null) {
      // Don't publish a fresh [] when already empty — every new array counts
      // as a signal change and would needlessly re-trigger subscribers.
      if (this.members().length > 0) this.members.set([]);
      return [];
    }
    try {
      const members = await this.kitchens.members();
      this.members.set(members);
      return members;
    } catch {
      return this.members(); // offline — keep what we have
    }
  }

  nameOf(userId: number | null): string {
    if (userId == null) return '';
    return this.members().find((m) => m.user_id === userId)?.name ?? '';
  }

  /** Colour for a user id (falls back to a neutral grey). */
  colorOf(userId: number | null): string {
    if (userId == null) return '#9ca3af';
    return this.members().find((m) => m.user_id === userId)?.color ?? '#9ca3af';
  }

  async updateMyColor(color: string): Promise<User> {
    const user = await firstValueFrom(this.http.patch<User>('/api/users/me', { color }));
    this.members.set(
      this.members().map((m) => (m.user_id === user.id ? { ...m, color: user.color } : m)),
    );
    return user;
  }
}
