import { Injectable, signal } from '@angular/core';

/**
 * Online/offline state. The source of truth is whether HTTP requests actually
 * succeed (reported by the connectivity interceptor); the browser's `online`/
 * `offline` events are only used as additional hints/triggers.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly online = signal(navigator.onLine);

  constructor() {
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }

  setOnline(value: boolean): void {
    if (this.online() !== value) this.online.set(value);
  }
}
