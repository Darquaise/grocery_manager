import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { User } from '../models';
import { LanguageService } from './language';
import { KitchensService } from './kitchens';

const USER_KEY = 'grocery.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private kitchens = inject(KitchensService);

  /** Current user, or null when logged out. Hydrated from cache so the app is
   * usable offline (the session is re-verified in the background). */
  readonly user = signal<User | null>(this.readCachedUser());

  async login(name: string, password: string): Promise<void> {
    const user = await firstValueFrom(this.http.post<User>('/api/login', { name, password }));
    this.setUser(user);
    await this.language.applyFromAccount(user);
    // Drop kitchen state a previous account may have left in this browser
    // (active kitchen id, cached shopping list) before loading our own.
    this.kitchens.clear();
    await this.kitchens.load();
  }

  /** Create an account with an invite code (the server logs it in directly). */
  async register(name: string, password: string, inviteCode: string): Promise<void> {
    const user = await firstValueFrom(
      this.http.post<User>('/api/register', { name, password, invite_code: inviteCode }),
    );
    this.setUser(user);
    await this.language.applyFromAccount(user);
    this.kitchens.clear();
    await this.kitchens.load();
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/logout', {}));
    this.setUser(null);
    this.kitchens.clear();
  }

  /** Resolve the session from the cookie (used by the route guard).
   * Offline (network error) we keep the cached user; only a real 401 logs out. */
  async fetchMe(): Promise<User | null> {
    try {
      const user = await firstValueFrom(this.http.get<User>('/api/me'));
      this.setUser(user);
      await this.language.applyFromAccount(user);
      return user;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        this.setUser(null);
        this.kitchens.clear();
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
