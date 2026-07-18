import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { User } from '../../models';
import { AuthService } from '../../services/auth';
import { CategoriesService } from '../../services/categories';
import { KitchensService } from '../../services/kitchens';
import { LocationsService } from '../../services/locations';
import { UsersService } from '../../services/users';
import { AccountInvites } from '../../components/account-invites';
import { EditableListComponent } from '../../components/editable-list';
import { KitchenManager } from '../../components/kitchen-manager';
import { LanguageSelector } from '../../components/language-selector';

@Component({
  selector: 'app-settings',
  imports: [
    FormsModule,
    TranslatePipe,
    AccountInvites,
    EditableListComponent,
    KitchenManager,
    LanguageSelector,
  ],
  template: `
    <header class="px-4 pb-2 pt-3">
      <h1 class="text-largetitle font-bold">{{ 'settings.title' | translate }}</h1>
    </header>

    <div class="space-y-5 px-4 pb-4">
      <app-language-selector variant="row" [persist]="true" />

      <app-kitchen-manager />

      <app-editable-list
        [title]="'settings.categories' | translate"
        [store]="categoriesSvc"
        [addPlaceholder]="'settings.newCategory' | translate"
        [canEdit]="kitchens.canWrite()"
      />
      <app-editable-list
        [title]="'settings.locations' | translate"
        [store]="locationsSvc"
        [addPlaceholder]="'settings.newLocation' | translate"
        [canEdit]="kitchens.canWrite()"
      />

      <!-- Member colours (own colour editable) -->
      <section class="ios-card p-4">
        <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'settings.usersColors' | translate }}</h2>
        <ul class="space-y-3">
          @for (m of users.members(); track m.user_id) {
            <li class="flex items-center gap-3">
              <span class="h-4 w-4 shrink-0 rounded-full" [style.background-color]="m.color"></span>
              <span class="flex-1 text-[17px]">{{ m.name }}</span>
              @if (m.user_id === auth.user()?.id) {
                <input
                  type="color"
                  [ngModel]="m.color"
                  (ngModelChange)="changeColor($event)"
                  class="h-8 w-12 rounded-lg bg-transparent"
                />
              }
            </li>
          }
        </ul>
      </section>

      <app-account-invites />

      <!-- Logout -->
      <button
        (click)="logout()"
        class="ios-card w-full p-4 text-center text-[17px] font-medium text-danger active:bg-surface-press"
      >
        {{ 'settings.logout' | translate }}
      </button>
    </div>
  `,
})
export class Settings {
  protected auth = inject(AuthService);
  protected users = inject(UsersService);
  protected kitchens = inject(KitchensService);
  protected categoriesSvc = inject(CategoriesService);
  protected locationsSvc = inject(LocationsService);
  private router = inject(Router);

  constructor() {
    if (this.users.members().length === 0) void this.users.load();
  }

  async changeColor(color: string): Promise<void> {
    const user: User = await this.users.updateMyColor(color);
    this.auth.setUser(user);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
