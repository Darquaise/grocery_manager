import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { AccountInvite, KitchenRole } from '../models';
import { InvitesService } from '../services/invites';
import { KitchensService } from '../services/kitchens';

/** Settings card: generate single-use registration codes for new accounts.
 * Admins can attach the active kitchen so the new account gets a pending
 * invitation into it (decided in the join dialog after registering). */
@Component({
  selector: 'app-account-invites',
  imports: [FormsModule, TranslatePipe],
  template: `
    <section class="ios-card p-4">
      <h2 class="pb-1 text-[13px] font-semibold text-label-2">{{ 'invites.title' | translate }}</h2>
      <p class="pb-3 text-[13px] text-label-3">{{ 'invites.hint' | translate }}</p>

      @if (invites.invites().length > 0) {
        <ul class="divide-y divide-separator">
          @for (invite of invites.invites(); track invite.id) {
            <li class="flex items-center gap-3 py-2.5">
              <span class="min-w-0 flex-1">
                @if (invite.used_by_name) {
                  <span class="block truncate font-mono text-[15px] text-label-3 line-through">
                    {{ invite.code }}
                  </span>
                } @else {
                  <button
                    (click)="copy(invite)"
                    class="block w-full truncate text-left font-mono text-[15px]"
                  >
                    {{ invite.code }}
                  </button>
                }
                @if (invite.kitchen_name) {
                  <span class="block truncate text-[12px] text-label-3">
                    {{ 'invites.joins' | translate: { kitchen: invite.kitchen_name } }}
                    · {{ 'kitchen.role.' + invite.kitchen_role | translate }}
                  </span>
                }
              </span>
              @if (invite.used_by_name) {
                <span class="shrink-0 text-[13px] text-label-2">
                  {{ 'invites.usedBy' | translate: { name: invite.used_by_name } }}
                </span>
              } @else {
                <button (click)="copy(invite)" class="shrink-0 text-[13px] text-tint">
                  {{ (copied() === invite.id ? 'invites.copied' : 'invites.copy') | translate }}
                </button>
                <button
                  (click)="revoke(invite)"
                  class="shrink-0 px-1 text-danger"
                  [attr.aria-label]="'invites.revoke' | translate"
                >
                  <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              }
            </li>
          }
        </ul>
      }

      @if (kitchens.canManage() && kitchens.active(); as kitchen) {
        <label class="mt-3 flex items-center gap-2.5 px-1">
          <input type="checkbox" [(ngModel)]="attachKitchen" class="h-4 w-4 accent-[var(--c-tint)]" />
          <span class="flex-1 text-[14px]">
            {{ 'invites.attach' | translate: { kitchen: kitchen.name } }}
          </span>
          @if (attachKitchen) {
            <select [(ngModel)]="attachRole" class="rounded-lg bg-fill px-2 py-1 text-[13px]">
              <option [ngValue]="'read'">{{ 'kitchen.role.read' | translate }}</option>
              <option [ngValue]="'write'">{{ 'kitchen.role.write' | translate }}</option>
              <option [ngValue]="'admin'">{{ 'kitchen.role.admin' | translate }}</option>
            </select>
          }
        </label>
      }

      <button (click)="generate()" [disabled]="busy()" class="btn btn-secondary mt-2 w-full">
        {{ 'invites.generate' | translate }}
      </button>
    </section>
  `,
})
export class AccountInvites {
  protected invites = inject(InvitesService);
  protected kitchens = inject(KitchensService);

  readonly busy = signal(false);
  readonly copied = signal<number | null>(null);
  attachKitchen = true;
  attachRole: KitchenRole = 'write';

  constructor() {
    void this.invites.load().catch(() => undefined);
  }

  async generate(): Promise<void> {
    this.busy.set(true);
    try {
      const attach = this.attachKitchen && this.kitchens.canManage();
      const invite = await this.invites.create(
        attach ? (this.kitchens.activeId() ?? undefined) : undefined,
        this.attachRole,
      );
      await this.copy(invite);
    } catch {
      // offline — the list simply stays as-is
    } finally {
      this.busy.set(false);
    }
  }

  async copy(invite: AccountInvite): Promise<void> {
    try {
      await navigator.clipboard.writeText(invite.code);
      this.copied.set(invite.id);
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      // Clipboard unavailable (http / permissions) — code stays visible to copy by hand.
    }
  }

  async revoke(invite: AccountInvite): Promise<void> {
    try {
      await this.invites.revoke(invite.id);
    } catch {
      // ignore — likely already used; the next load will show it
    }
  }
}
