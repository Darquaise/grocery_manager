import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth';
import { LegalService } from '../../services/legal';
import { LanguageSelector } from '../../components/language-selector';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, TranslatePipe, LanguageSelector],
  template: `
    <div class="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10">
      <app-language-selector />
    </div>

    <div class="flex min-h-dvh items-center justify-center p-6">
      <form (ngSubmit)="submit()" class="w-full max-w-sm space-y-4">
        <div class="mb-3 flex flex-col items-center gap-3 text-center">
          <span class="flex h-16 w-16 items-center justify-center rounded-[18px] bg-tint shadow-lg shadow-tint/30">
            <svg class="h-9 w-9 text-on-tint" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.36-1.99 1.26 12c.07.66-.45 1.24-1.12 1.24H4.25a1.13 1.13 0 0 1-1.12-1.24l1.26-12A1.13 1.13 0 0 1 5.51 7.5h12.98c.58 0 1.06.44 1.12 1.01Z" />
            </svg>
          </span>
          <h1 class="text-title2 font-bold">{{ 'login.title' | translate }}</h1>
        </div>
        <input
          name="name"
          [(ngModel)]="name"
          [placeholder]="'login.name' | translate"
          autocomplete="username"
          class="field"
        />
        <input
          name="password"
          type="password"
          [(ngModel)]="password"
          [placeholder]="'login.password' | translate"
          [autocomplete]="registering() ? 'new-password' : 'current-password'"
          class="field"
        />
        @if (registering()) {
          <input
            name="inviteCode"
            [(ngModel)]="inviteCode"
            [placeholder]="'login.inviteCode' | translate"
            autocomplete="off"
            class="field"
          />
        }
        @if (error) {
          <p class="text-center text-[15px] text-danger">{{ error }}</p>
        }
        <button type="submit" [disabled]="loading" class="btn btn-primary w-full">
          {{ (registering() ? 'login.register' : 'login.signIn') | translate }}
        </button>
        <button
          type="button"
          (click)="toggleMode()"
          class="w-full py-1 text-center text-[15px] text-tint"
        >
          {{ (registering() ? 'login.haveAccount' : 'login.noAccount') | translate }}
        </button>
        <p class="flex justify-center gap-4 pt-2 text-[13px] text-label-3">
          @if (legal.info()?.configured) {
            <a routerLink="/impressum">{{ 'imprint.link' | translate }}</a>
          }
          <a routerLink="/datenschutz">{{ 'privacy.link' | translate }}</a>
        </p>
      </form>
    </div>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  protected legal = inject(LegalService);

  name = '';
  password = '';
  inviteCode = '';
  error = '';
  loading = false;
  readonly registering = signal(false);

  constructor() {
    void this.legal.load();
  }

  toggleMode(): void {
    this.registering.set(!this.registering());
    this.error = '';
  }

  async submit(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      if (this.registering()) {
        await this.auth.register(this.name.trim(), this.password, this.inviteCode.trim());
      } else {
        await this.auth.login(this.name, this.password);
      }
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.error = this.translate.instant(this.errorKey(err));
    } finally {
      this.loading = false;
    }
  }

  private errorKey(err: unknown): string {
    if (!this.registering()) return 'login.failed';
    if (err instanceof HttpErrorResponse && err.status === 403) return 'login.badInvite';
    if (err instanceof HttpErrorResponse && err.status === 409) return 'login.nameTaken';
    return 'login.registerFailed';
  }
}
