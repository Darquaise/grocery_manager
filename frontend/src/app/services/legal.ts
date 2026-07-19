import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/** Provider details behind the imprint and privacy pages, served by /api/legal. */
export interface LegalInfo {
  /** False while the operator has not filled in name + street + city. */
  configured: boolean;
  name: string;
  care_of: string;
  street: string;
  city: string;
  country: string;
  email: string;
  vat_id: string;
  hosting_provider: string;
}

/**
 * The values come from the deployment's `.env` rather than the source tree, so
 * that anyone self-hosting this project publishes their own details instead of
 * ours. Loaded once and cached; the data is public and never changes at runtime.
 */
@Injectable({ providedIn: 'root' })
export class LegalService {
  private http = inject(HttpClient);

  readonly info = signal<LegalInfo | null>(null);
  private pending: Promise<LegalInfo | null> | null = null;

  /** Loads once; concurrent callers share the same request. */
  load(): Promise<LegalInfo | null> {
    if (this.info() !== null) return Promise.resolve(this.info());
    this.pending ??= firstValueFrom(this.http.get<LegalInfo>('/api/legal'))
      .then((info) => {
        this.info.set(info);
        return info;
      })
      .catch(() => null) // offline: pages render their fallback
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}
