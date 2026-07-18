import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';

import { AuthService } from './services/auth';
import { UsersService } from './services/users';
import { ShoppingService } from './services/shopping';
import { ConnectivityService } from './services/connectivity';
import { LiveService } from './services/live';
import { SyncService } from './services/sync';
import { ConflictDialog } from './components/conflict-dialog';
import { InviteDialog } from './components/invite-dialog';
import { KitchensService } from './services/kitchens';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConflictDialog, InviteDialog, TranslatePipe],
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  protected auth = inject(AuthService);
  protected shopping = inject(ShoppingService);
  protected connectivity = inject(ConnectivityService);
  protected sync = inject(SyncService);
  private users = inject(UsersService);
  private kitchens = inject(KitchensService);
  private swUpdate = inject(SwUpdate);
  // Instantiated for its side effects: the SSE live-update connection.
  private live = inject(LiveService);

  private url = signal(this.router.url);
  protected showNav = computed(() => this.auth.user() !== null && !this.url().startsWith('/login'));
  /** User id the warm-up effect already ran for (once per login). */
  private warmedForUser: number | null = null;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.url.set(e.urlAfterRedirects));

    // Once per login, warm the member-colour cache and the cached shopping
    // list, and check for pending kitchen invitations (join dialog). Tracks
    // ONLY the user signal and guards via `warmedForUser` — keying off e.g.
    // "members still empty" would re-trigger on every write to that signal
    // and (for a kitchen-less account) loop into an endless request storm.
    effect(() => {
      const user = this.auth.user();
      if (!user) {
        this.warmedForUser = null;
        return;
      }
      if (this.warmedForUser === user.id) return;
      this.warmedForUser = user.id;
      untracked(() => {
        void this.users.load();
        void this.shopping.load();
        void this.kitchens.loadMyInvites();
      });
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
