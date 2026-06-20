import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from './services/auth';
import { UsersService } from './services/users';
import { ShoppingService } from './services/shopping';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  protected auth = inject(AuthService);
  protected shopping = inject(ShoppingService);
  private users = inject(UsersService);

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
  }
}
