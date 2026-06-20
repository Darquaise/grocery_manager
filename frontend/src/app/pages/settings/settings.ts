import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { User } from '../../models';
import { AuthService } from '../../services/auth';
import { CategoriesService } from '../../services/categories';
import { LocationsService } from '../../services/locations';
import { UsersService } from '../../services/users';
import { EditableListComponent } from '../../components/editable-list';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, EditableListComponent],
  template: `
    <header class="p-4">
      <h1 class="text-2xl font-semibold">Einstellungen</h1>
    </header>

    <div class="space-y-4 px-4 pb-4">
      <app-editable-list title="Kategorien" [store]="categoriesSvc" addPlaceholder="Neue Kategorie…" />
      <app-editable-list title="Lagerorte" [store]="locationsSvc" addPlaceholder="Neuer Lagerort…" />

      <!-- User colours -->
      <section
        class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <h2 class="pb-3 text-xs font-semibold uppercase tracking-wide opacity-50">Nutzer &amp; Farben</h2>
        <ul class="space-y-3">
          @for (u of users.users(); track u.id) {
            <li class="flex items-center gap-3">
              <span class="h-4 w-4 shrink-0 rounded-full" [style.background-color]="u.color"></span>
              <span class="flex-1">{{ u.name }}</span>
              @if (u.id === auth.user()?.id) {
                <input
                  type="color"
                  [ngModel]="u.color"
                  (ngModelChange)="changeColor($event)"
                  class="h-8 w-12 bg-transparent"
                />
              }
            </li>
          }
        </ul>
      </section>

      <!-- Logout -->
      <button
        (click)="logout()"
        class="w-full rounded-2xl border border-gray-200 bg-white py-3 font-medium dark:border-neutral-800 dark:bg-neutral-900"
      >
        Abmelden
      </button>
    </div>
  `,
})
export class Settings {
  protected auth = inject(AuthService);
  protected users = inject(UsersService);
  protected categoriesSvc = inject(CategoriesService);
  protected locationsSvc = inject(LocationsService);
  private router = inject(Router);

  constructor() {
    if (this.users.users().length === 0) void this.users.load();
  }

  async changeColor(color: string): Promise<void> {
    const user: User = await this.users.updateMyColor(color);
    this.auth.user.set(user);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
