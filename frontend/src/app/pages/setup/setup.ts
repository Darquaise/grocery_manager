import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth';
import { KitchensService } from '../../services/kitchens';

/** Fresh accounts land here: no kitchen yet — create one (or get added to one
 * by another user and come back). */
@Component({
  selector: 'app-setup',
  imports: [FormsModule, TranslatePipe],
  template: `
    <div class="flex min-h-dvh items-center justify-center p-6">
      <div class="w-full max-w-sm space-y-4">
        <div class="mb-2 text-center">
          <h1 class="text-title2 font-bold">{{ 'setup.title' | translate }}</h1>
          <p class="mt-2 text-[15px] text-label-2">{{ 'setup.hint' | translate }}</p>
        </div>

        <form (ngSubmit)="create()" class="space-y-4">
          <input
            name="name"
            [(ngModel)]="name"
            [placeholder]="'setup.kitchenName' | translate"
            class="field"
          />
          @if (error()) {
            <p class="text-center text-[15px] text-danger">{{ error() }}</p>
          }
          <button type="submit" [disabled]="busy()" class="btn btn-primary w-full">
            {{ 'setup.create' | translate }}
          </button>
        </form>

        <button (click)="refresh()" [disabled]="busy()" class="btn btn-secondary w-full">
          {{ 'setup.refresh' | translate }}
        </button>
        <button (click)="logout()" class="w-full py-2 text-center text-[15px] text-danger">
          {{ 'settings.logout' | translate }}
        </button>
      </div>
    </div>
  `,
})
export class Setup {
  private auth = inject(AuthService);
  private kitchens = inject(KitchensService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  name = '';
  readonly busy = signal(false);
  readonly error = signal('');

  async create(): Promise<void> {
    const name = this.name.trim();
    if (!name) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.kitchens.create(name);
      await this.router.navigateByUrl('/');
    } catch {
      this.error.set(this.translate.instant('setup.failed'));
    } finally {
      this.busy.set(false);
    }
  }

  /** Someone may have added me to their kitchen in the meantime. */
  async refresh(): Promise<void> {
    this.busy.set(true);
    try {
      await this.kitchens.load();
      if (this.kitchens.activeId() != null) await this.router.navigateByUrl('/');
    } finally {
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
