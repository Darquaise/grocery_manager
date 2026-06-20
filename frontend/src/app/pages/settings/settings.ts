import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { Category, User } from '../../models';
import { AuthService } from '../../services/auth';
import { CategoriesService } from '../../services/categories';
import { UsersService } from '../../services/users';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <header class="p-4">
      <h1 class="text-xl font-semibold">Einstellungen</h1>
    </header>

    <!-- Categories -->
    <section class="px-4">
      <h2 class="pb-2 text-xs font-semibold uppercase tracking-wide opacity-50">Kategorien</h2>
      <ul class="space-y-2">
        @for (c of categories(); track c.id) {
          <li class="flex items-center gap-2">
            <input
              [ngModel]="edits()[c.id]"
              (ngModelChange)="setEdit(c.id, $event)"
              class="flex-1 rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
            />
            <button (click)="rename(c)" class="rounded-lg bg-gray-200 px-3 py-2 text-sm dark:bg-neutral-800">Speichern</button>
            <button (click)="removeCategory(c)" class="px-2 text-lg text-red-500" aria-label="Löschen">×</button>
          </li>
        }
      </ul>
      <form (ngSubmit)="addCategory()" class="mt-2 flex gap-2">
        <input
          name="newCat"
          [(ngModel)]="newCategory"
          placeholder="Neue Kategorie…"
          class="flex-1 rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-neutral-700"
        />
        <button type="submit" class="rounded-lg bg-blue-600 px-4 font-medium text-white">+</button>
      </form>
    </section>

    <!-- User colours -->
    <section class="mt-6 px-4">
      <h2 class="pb-2 text-xs font-semibold uppercase tracking-wide opacity-50">Nutzer &amp; Farben</h2>
      <ul class="space-y-2">
        @for (u of users.users(); track u.id) {
          <li class="flex items-center gap-3">
            <span class="h-4 w-4 rounded-full" [style.background-color]="u.color"></span>
            <span class="flex-1">{{ u.name }}</span>
            @if (u.id === auth.user()?.id) {
              <input type="color" [ngModel]="u.color" (ngModelChange)="changeColor($event)" class="h-8 w-12 bg-transparent" />
            }
          </li>
        }
      </ul>
    </section>

    <!-- Logout -->
    <section class="mt-6 px-4">
      <button (click)="logout()" class="w-full rounded-lg border border-gray-300 py-2.5 dark:border-neutral-700">
        Abmelden
      </button>
    </section>
  `,
})
export class Settings {
  protected auth = inject(AuthService);
  protected users = inject(UsersService);
  private categoriesSvc = inject(CategoriesService);
  private router = inject(Router);

  readonly categories = signal<Category[]>([]);
  readonly edits = signal<Record<number, string>>({});
  newCategory = '';

  constructor() {
    void this.loadCategories();
    if (this.users.users().length === 0) void this.users.load();
  }

  private async loadCategories(): Promise<void> {
    const cats = await this.categoriesSvc.list();
    this.categories.set(cats);
    this.edits.set(Object.fromEntries(cats.map((c) => [c.id, c.name])));
  }

  setEdit(id: number, value: string): void {
    this.edits.set({ ...this.edits(), [id]: value });
  }

  async rename(c: Category): Promise<void> {
    const name = (this.edits()[c.id] ?? '').trim();
    if (!name || name === c.name) return;
    await this.categoriesSvc.update(c.id, { name });
    await this.loadCategories();
  }

  async removeCategory(c: Category): Promise<void> {
    if (!confirm(`Kategorie „${c.name}" löschen?`)) return;
    await this.categoriesSvc.remove(c.id);
    await this.loadCategories();
  }

  async addCategory(): Promise<void> {
    const name = this.newCategory.trim();
    if (!name) return;
    await this.categoriesSvc.create(name, this.categories().length);
    this.newCategory = '';
    await this.loadCategories();
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
