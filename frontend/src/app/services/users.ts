import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { User } from '../models';

@Injectable({ providedIn: 'root' })
export class UsersService {
  private http = inject(HttpClient);

  /** Both accounts, cached for colour lookups across the UI. */
  readonly users = signal<User[]>([]);

  async load(): Promise<User[]> {
    const users = await firstValueFrom(this.http.get<User[]>('/api/users'));
    this.users.set(users);
    return users;
  }

  /** Colour for a user id (falls back to a neutral grey). */
  colorOf(userId: number | null): string {
    if (userId == null) return '#9ca3af';
    return this.users().find((u) => u.id === userId)?.color ?? '#9ca3af';
  }

  async updateMyColor(color: string): Promise<User> {
    const user = await firstValueFrom(this.http.patch<User>('/api/users/me', { color }));
    this.users.set(this.users().map((u) => (u.id === user.id ? user : u)));
    return user;
  }
}
