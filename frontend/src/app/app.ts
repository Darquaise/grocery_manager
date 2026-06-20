import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

import { AuthService } from './services/auth';
import { UsersService } from './services/users';
import { ShoppingService } from './services/shopping';
import { ConnectivityService } from './services/connectivity';
import { SyncService } from './services/sync';
import { ConflictDialog } from './components/conflict-dialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConflictDialog],
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  protected auth = inject(AuthService);
  protected shopping = inject(ShoppingService);
  protected connectivity = inject(ConnectivityService);
  protected sync = inject(SyncService);
  private users = inject(UsersService);
  private swUpdate = inject(SwUpdate);

  private url = signal(this.router.url);
  protected showNav = computed(() => this.auth.user() !== null && !this.url().startsWith('/login'));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.url.set(e.urlAfterRedirects));

    // Once logged in, warm the user-colour cache and the cached shopping list.
    effect(() => {
      if (this.auth.user() && this.users.users().length === 0) {
        void this.users.load();
        void this.shopping.load();
      }
    });

    this.watchForUpdates();
  }

  /**
   * The app runs as an installed PWA whose shell is cached by the service
   * worker. When a new version is deployed, auto-activate it and reload so the
   * device never gets stuck on a stale build. iOS keeps installed PWAs
   * suspended, so we also re-check whenever the app becomes visible again.
   */
  private watchForUpdates(): void {
    if (!this.swUpdate.isEnabled) return; // disabled in dev / unsupported browsers

    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => void this.swUpdate.activateUpdate().then(() => document.location.reload()));

    const check = () => void this.swUpdate.checkForUpdate().catch(() => undefined);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 60_000);
    check();
  }
}
