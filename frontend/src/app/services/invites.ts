import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { AccountInvite, KitchenRole } from '../models';

/** Single-use registration codes: any account can invite new accounts. */
@Injectable({ providedIn: 'root' })
export class InvitesService {
  private http = inject(HttpClient);

  readonly invites = signal<AccountInvite[]>([]);

  async load(): Promise<void> {
    this.invites.set(await firstValueFrom(this.http.get<AccountInvite[]>('/api/invites')));
  }

  /** Attaching a kitchen (admin only) makes the registered account land in a
   * pending invitation for it. */
  async create(kitchenId?: number, role: KitchenRole = 'write'): Promise<AccountInvite> {
    const body = kitchenId != null ? { kitchen_id: kitchenId, kitchen_role: role } : {};
    const invite = await firstValueFrom(this.http.post<AccountInvite>('/api/invites', body));
    this.invites.set([invite, ...this.invites()]);
    return invite;
  }

  async revoke(id: number): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`/api/invites/${id}`));
    this.invites.set(this.invites().filter((i) => i.id !== id));
  }
}
