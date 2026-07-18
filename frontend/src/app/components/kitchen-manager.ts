import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { KitchenMember, KitchenRole, PendingInvite } from '../models';
import { AuthService } from '../services/auth';
import { KitchensService } from '../services/kitchens';
import { LiveService } from '../services/live';
import { UsersService } from '../services/users';

const ROLES: KitchenRole[] = ['read', 'write', 'admin'];

/**
 * Settings card for the active kitchen: switch between kitchens, rename
 * (admin), manage members + roles (admin), transfer ownership (owner), leave
 * (non-owner) and create additional kitchens.
 */
@Component({
  selector: 'app-kitchen-manager',
  imports: [FormsModule, TranslatePipe],
  template: `
    <section class="ios-card p-4">
      <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'kitchen.title' | translate }}</h2>

      <!-- switcher -->
      @if (kitchens.kitchens().length > 1) {
        <label class="mb-3 block">
          <span class="mb-1.5 block text-[13px] font-medium text-label-2">{{ 'kitchen.active' | translate }}</span>
          <select
            [ngModel]="kitchens.activeId()"
            (ngModelChange)="switchTo($event)"
            class="field-2 select w-full"
          >
            @for (k of kitchens.kitchens(); track k.id) {
              <option [ngValue]="k.id">{{ k.name }}</option>
            }
          </select>
        </label>
      }

      @if (kitchens.active(); as active) {
        <!-- name (admins edit inline) -->
        @if (kitchens.canManage()) {
          <div class="flex gap-2">
            <input [(ngModel)]="nameDraft" class="field-2 min-w-0 flex-1" />
            <button
              (click)="rename()"
              [disabled]="busy() || nameDraft.trim() === active.name"
              class="btn btn-secondary shrink-0 px-4"
            >
              {{ 'kitchen.rename' | translate }}
            </button>
          </div>
        } @else {
          <p class="text-[17px] font-medium">{{ active.name }}</p>
        }
        <p class="mt-1.5 text-[13px] text-label-2">
          {{ 'kitchen.myRole' | translate }}:
          {{ 'kitchen.role.' + (active.is_owner ? 'owner' : active.my_role) | translate }}
        </p>

        <!-- members -->
        <h3 class="mt-4 border-t border-separator pt-3 text-[13px] font-semibold text-label-2">
          {{ 'kitchen.members' | translate }}
        </h3>
        <ul class="divide-y divide-separator">
          @for (m of users.members(); track m.user_id) {
            <li class="flex items-center gap-3 py-2.5">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background-color]="m.color"></span>
              <span class="min-w-0 flex-1 truncate text-[16px]">{{ m.name }}</span>
              @if (m.is_owner) {
                <span class="rounded-full bg-fill px-2 py-0.5 text-[12px] font-medium text-label-2">
                  {{ 'kitchen.role.owner' | translate }}
                </span>
              } @else if (kitchens.canManage()) {
                <select
                  [ngModel]="m.role"
                  (ngModelChange)="setRole(m, $event)"
                  class="rounded-lg bg-fill px-2 py-1 text-[13px]"
                >
                  @for (r of roles; track r) {
                    <option [ngValue]="r">{{ 'kitchen.role.' + r | translate }}</option>
                  }
                </select>
                <button
                  (click)="removeMember(m)"
                  class="px-1 text-danger"
                  [attr.aria-label]="'kitchen.removeMember' | translate"
                >
                  <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              } @else {
                <span class="text-[13px] text-label-2">{{ 'kitchen.role.' + m.role | translate }}</span>
              }
            </li>
          }
        </ul>

        <!-- pending invitations + invite form -->
        @if (kitchens.canManage()) {
          @for (invite of pending(); track invite.id) {
            <div class="flex items-center gap-3 border-t border-separator py-2.5 first-of-type:border-t-0">
              <span class="min-w-0 flex-1 truncate text-[16px] text-label-2">{{ invite.name }}</span>
              <span class="rounded-full bg-fill px-2 py-0.5 text-[12px] font-medium text-label-2">
                {{ 'kitchen.pending' | translate }} · {{ 'kitchen.role.' + invite.role | translate }}
              </span>
              <button
                (click)="revokeInvite(invite)"
                class="px-1 text-danger"
                [attr.aria-label]="'kitchen.revokeInvite' | translate"
              >
                <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          }
          <form (ngSubmit)="inviteMember()" class="mt-2 flex gap-2">
            <input
              name="memberName"
              [(ngModel)]="newMemberName"
              [placeholder]="'kitchen.addMemberPlaceholder' | translate"
              class="field-2 min-w-0 flex-1"
            />
            <select name="memberRole" [(ngModel)]="newMemberRole" class="field-2 select w-auto shrink-0">
              @for (r of roles; track r) {
                <option [ngValue]="r">{{ 'kitchen.role.' + r | translate }}</option>
              }
            </select>
            <button type="submit" [disabled]="busy()" class="btn btn-secondary shrink-0 px-3" [attr.aria-label]="'kitchen.addMember' | translate">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </form>
          <p class="mt-1.5 px-1 text-[12px] text-label-3">{{ 'kitchen.inviteHint' | translate }}</p>
        }
        @if (error()) {
          <p class="mt-2 text-[14px] text-danger">{{ error() }}</p>
        }

        <!-- ownership / membership actions -->
        @if (kitchens.isOwner() && transferCandidates().length > 0) {
          <div class="mt-4 border-t border-separator pt-3">
            <span class="mb-1.5 block text-[13px] font-medium text-label-2">{{ 'kitchen.transferTitle' | translate }}</span>
            <div class="flex gap-2">
              <select [(ngModel)]="transferTarget" class="field-2 select min-w-0 flex-1">
                <option [ngValue]="null">{{ 'kitchen.transferSelect' | translate }}</option>
                @for (m of transferCandidates(); track m.user_id) {
                  <option [ngValue]="m.user_id">{{ m.name }}</option>
                }
              </select>
              <button
                (click)="transfer()"
                [disabled]="transferTarget === null || busy()"
                class="btn btn-secondary shrink-0 px-4"
              >
                {{ 'kitchen.transfer' | translate }}
              </button>
            </div>
          </div>
        }
        @if (!kitchens.isOwner()) {
          <button (click)="leave()" [disabled]="busy()" class="btn btn-danger mt-4 w-full">
            {{ 'kitchen.leave' | translate }}
          </button>
        } @else {
          <button (click)="deleteKitchen()" [disabled]="busy()" class="btn btn-danger mt-4 w-full">
            {{ 'kitchen.delete' | translate }}
          </button>
        }
      }

      <!-- create another kitchen -->
      <form (ngSubmit)="create()" class="mt-4 flex gap-2 border-t border-separator pt-3">
        <input
          name="newKitchen"
          [(ngModel)]="newKitchenName"
          [placeholder]="'kitchen.newPlaceholder' | translate"
          class="field-2 min-w-0 flex-1"
        />
        <button type="submit" [disabled]="busy()" class="btn btn-secondary shrink-0 px-4">
          {{ 'kitchen.create' | translate }}
        </button>
      </form>
    </section>
  `,
})
export class KitchenManager {
  protected kitchens = inject(KitchensService);
  protected users = inject(UsersService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private live = inject(LiveService);

  protected readonly roles = ROLES;

  nameDraft = '';
  newMemberName = '';
  newMemberRole: KitchenRole = 'write';
  newKitchenName = '';
  transferTarget: number | null = null;

  readonly busy = signal(false);
  readonly error = signal('');
  readonly pending = signal<PendingInvite[]>([]);

  readonly transferCandidates = computed(() =>
    this.users.members().filter((m) => !m.is_owner),
  );

  constructor() {
    this.nameDraft = this.kitchens.active()?.name ?? '';
    if (this.users.members().length === 0) void this.users.load();
    void this.loadPending();
    // Live: invitations accepted/declined elsewhere update the pending list
    // (members refresh globally via UsersService).
    this.live.onChange(() => void this.loadPending());
  }

  switchTo(id: number): void {
    this.kitchens.select(id);
    this.nameDraft = this.kitchens.active()?.name ?? '';
    this.error.set('');
    this.pending.set([]);
    void this.loadPending();
  }

  private async loadPending(): Promise<void> {
    if (!this.kitchens.canManage()) return;
    try {
      this.pending.set(await this.kitchens.pendingInvites());
    } catch {
      // offline — the section simply stays empty
    }
  }

  async rename(): Promise<void> {
    const name = this.nameDraft.trim();
    if (!name) return;
    await this.run(async () => {
      await this.kitchens.rename(name);
    });
  }

  async inviteMember(): Promise<void> {
    const name = this.newMemberName.trim();
    if (!name) return;
    await this.run(
      async () => {
        this.pending.set(await this.kitchens.invite(name, this.newMemberRole));
        this.newMemberName = '';
      },
      (err) => {
        if (err instanceof HttpErrorResponse && err.status === 404) return 'kitchen.userNotFound';
        if (err instanceof HttpErrorResponse && err.status === 409) return 'kitchen.alreadyMember';
        return 'kitchen.actionFailed';
      },
    );
  }

  async revokeInvite(invite: PendingInvite): Promise<void> {
    await this.run(async () => {
      await this.kitchens.revokeInvite(invite.id);
      this.pending.set(this.pending().filter((i) => i.id !== invite.id));
    });
  }

  async setRole(member: KitchenMember, role: KitchenRole): Promise<void> {
    await this.run(async () => {
      this.users.members.set(await this.kitchens.updateRole(member.user_id, role));
    });
  }

  async removeMember(member: KitchenMember): Promise<void> {
    if (!confirm(this.translate.instant('kitchen.confirmRemove', { name: member.name }))) return;
    await this.run(async () => {
      await this.kitchens.removeMember(member.user_id);
      this.users.members.set(this.users.members().filter((m) => m.user_id !== member.user_id));
    });
  }

  async transfer(): Promise<void> {
    const target = this.users.members().find((m) => m.user_id === this.transferTarget);
    if (!target) return;
    if (!confirm(this.translate.instant('kitchen.confirmTransfer', { name: target.name }))) return;
    await this.run(async () => {
      this.users.members.set(await this.kitchens.transferOwnership(target.user_id));
      this.transferTarget = null;
    });
  }

  async leave(): Promise<void> {
    if (!confirm(this.translate.instant('kitchen.confirmLeave'))) return;
    const me = this.auth.user();
    if (!me) return;
    await this.run(async () => {
      await this.kitchens.leave(me.id);
      await this.afterKitchenGone();
    });
  }

  async create(): Promise<void> {
    const name = this.newKitchenName.trim();
    if (!name) return;
    await this.run(async () => {
      const kitchen = await this.kitchens.create(name);
      this.newKitchenName = '';
      this.switchTo(kitchen.id);
    });
  }

  async deleteKitchen(): Promise<void> {
    const kitchen = this.kitchens.active();
    if (!kitchen) return;
    if (!confirm(this.translate.instant('kitchen.confirmDelete', { name: kitchen.name }))) return;
    await this.run(async () => {
      await this.kitchens.deleteKitchen();
      await this.afterKitchenGone();
    });
  }

  /** After leaving/deleting: sync the card to the fallback kitchen, or send a
   * now kitchen-less account to the setup screen. */
  private async afterKitchenGone(): Promise<void> {
    this.nameDraft = this.kitchens.active()?.name ?? '';
    this.pending.set([]);
    void this.loadPending();
    void this.users.load();
    if (this.kitchens.activeId() == null) await this.router.navigateByUrl('/setup');
  }

  /** Shared busy/error handling for all actions. */
  private async run(
    action: () => Promise<void>,
    errorKey: (err: unknown) => string = () => 'kitchen.actionFailed',
  ): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
    } catch (err) {
      this.error.set(this.translate.instant(errorKey(err)));
    } finally {
      this.busy.set(false);
    }
  }
}
