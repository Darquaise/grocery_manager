import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { KitchenInvite } from '../models';
import { KitchensService } from '../services/kitchens';

/**
 * Modal shown when the logged-in user has pending kitchen invitations
 * (invited by name, or registered with a kitchen-linked code). Accept joins
 * the kitchen and makes it active; decline removes the invitation.
 * Self-hides when there is nothing pending; rendered once in the app shell.
 */
@Component({
  selector: 'app-invite-dialog',
  imports: [TranslatePipe],
  template: `
    @if (kitchens.myInvites().length) {
      <div class="sheet-backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grabber"></div>
        <h2 class="pt-2 text-center text-title2 font-bold">{{ 'kitchenInvite.title' | translate }}</h2>
        <ul class="mt-4 max-h-[55vh] space-y-3 overflow-y-auto">
          @for (invite of kitchens.myInvites(); track invite.id) {
            <li class="rounded-[14px] bg-fill p-3">
              <p class="text-[15px] text-label-2">
                {{ 'kitchenInvite.intro' | translate: { name: invite.invited_by_name } }}
              </p>
              <p class="mt-0.5 text-[17px] font-medium">
                {{ invite.kitchen_name }}
                <span class="font-normal text-label-2">
                  · {{ 'kitchen.role.' + invite.role | translate }}</span
                >
              </p>
              <div class="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  (click)="decline(invite)"
                  [disabled]="busy()"
                  class="rounded-[12px] border border-separator bg-surface px-2 py-2.5 text-[15px] font-medium active:bg-surface-press"
                >
                  {{ 'kitchenInvite.decline' | translate }}
                </button>
                <button
                  (click)="accept(invite)"
                  [disabled]="busy()"
                  class="rounded-[12px] border-2 border-tint bg-surface px-2 py-2.5 text-[15px] font-semibold text-tint active:bg-surface-press"
                >
                  {{ 'kitchenInvite.accept' | translate }}
                </button>
              </div>
            </li>
          }
        </ul>
      </div>
    }
  `,
})
export class InviteDialog {
  protected kitchens = inject(KitchensService);
  private router = inject(Router);

  readonly busy = signal(false);

  async accept(invite: KitchenInvite): Promise<void> {
    this.busy.set(true);
    try {
      await this.kitchens.acceptInvite(invite);
      // A kitchen-less account sat on the setup screen — it can enter now.
      if (this.router.url.startsWith('/setup')) await this.router.navigateByUrl('/');
    } catch {
      await this.kitchens.loadMyInvites(); // e.g. invite was revoked meanwhile
    } finally {
      this.busy.set(false);
    }
  }

  async decline(invite: KitchenInvite): Promise<void> {
    this.busy.set(true);
    try {
      await this.kitchens.declineInvite(invite);
    } catch {
      await this.kitchens.loadMyInvites();
    } finally {
      this.busy.set(false);
    }
  }
}
