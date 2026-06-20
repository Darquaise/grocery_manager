import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { User } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  /** Current user, or null when logged out. */
  readonly user = signal<User | null>(null);

  async login(name: string, password: string): Promise<void> {
    const user = await firstValueFrom(
      this.http.post<User>('/api/login', { name, password }),
    );
    this.user.set(user);
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/logout', {}));
    this.user.set(null);
  }

  /** Resolve the session from the cookie (used by the route guard). */
  async fetchMe(): Promise<User | null> {
    try {
      const user = await firstValueFrom(this.http.get<User>('/api/me'));
      this.user.set(user);
      return user;
    } catch {
      this.user.set(null);
      return null;
    }
  }
}
