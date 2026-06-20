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
        <h1 class="text-center text-2xl font-semibold">Grocery Manager</h1>
        <input
          name="name"
          [(ngModel)]="name"
          placeholder="Name"
          autocomplete="username"
          class="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
        />
        <input
          name="password"
          type="password"
          [(ngModel)]="password"
          placeholder="Passwort"
          autocomplete="current-password"
          class="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
        />
        @if (error) {
          <p class="text-sm text-red-600">{{ error }}</p>
        }
        <button
          type="submit"
          [disabled]="loading"
          class="w-full rounded-lg bg-blue-600 py-2 font-medium text-white disabled:opacity-50"
        >
          Anmelden
        </button>
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
