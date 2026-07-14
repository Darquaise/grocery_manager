import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="flex min-h-dvh items-center justify-center p-6">
      <form (ngSubmit)="submit()" class="w-full max-w-sm space-y-4">
        <div class="mb-3 flex flex-col items-center gap-3 text-center">
          <span class="flex h-16 w-16 items-center justify-center rounded-[18px] bg-tint shadow-lg shadow-tint/30">
            <svg class="h-9 w-9 text-on-tint" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.36-1.99 1.26 12c.07.66-.45 1.24-1.12 1.24H4.25a1.13 1.13 0 0 1-1.12-1.24l1.26-12A1.13 1.13 0 0 1 5.51 7.5h12.98c.58 0 1.06.44 1.12 1.01Z" />
            </svg>
          </span>
          <h1 class="text-title2 font-bold">Grocery Manager</h1>
        </div>
        <input
          name="name"
          [(ngModel)]="name"
          placeholder="Name"
          autocomplete="username"
          class="field"
        />
        <input
          name="password"
          type="password"
          [(ngModel)]="password"
          placeholder="Passwort"
          autocomplete="current-password"
          class="field"
        />
        @if (error) {
          <p class="text-center text-[15px] text-danger">{{ error }}</p>
        }
        <button type="submit" [disabled]="loading" class="btn btn-primary w-full">Anmelden</button>
      </form>
    </div>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);

  name = '';
  password = '';
  error = '';
  loading = false;

  async submit(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      await this.auth.login(this.name, this.password);
      await this.router.navigateByUrl('/');
    } catch {
      this.error = 'Login fehlgeschlagen.';
    } finally {
      this.loading = false;
    }
  }
}
