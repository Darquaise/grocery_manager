import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { User } from '../models';

const USER_KEY = 'grocery.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  /** Current user, or null when logged out. Hydrated from cache so the app is
   * usable offline (the session is re-verified in the background). */
  readonly user = signal<User | null>(this.readCachedUser());

  async login(name: string, password: string): Promise<void> {
    const user = await firstValueFrom(this.http.post<User>('/api/login', { name, password }));
    this.setUser(user);
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/logout', {}));
    this.setUser(null);
  }

  /** Resolve the session from the cookie (used by the route guard).
   * Offline (network error) we keep the cached user; only a real 401 logs out. */
  async fetchMe(): Promise<User | null> {
    try {
      const user = await firstValueFrom(this.http.get<User>('/api/me'));
      this.setUser(user);
      return user;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        this.setUser(null);
        return null;
      }
      return this.user(); // offline / server unreachable → keep what we have
    }
  }

  /** Expose for the guard: the signal setter that also persists to the cache. */
  setUser(user: User | null): void {
    this.user.set(user);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }

  private readCachedUser(): User | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }
}
