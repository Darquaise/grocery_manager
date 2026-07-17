import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { User } from '../models';
import { DEFAULT_LANGUAGE, isSupported } from '../i18n/languages';
import { configureFormat } from '../util/format';

const LANG_KEY = 'grocery.lang';

/**
 * Owns the active UI language. Persists the choice locally (so a returning,
 * still-logged-out visitor keeps it) and — once logged in — mirrors it to the
 * account so it follows the user across devices.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);
  private http = inject(HttpClient);

  readonly current = signal<string>(this.initialLanguage());

  constructor() {
    this.apply(this.current());
  }

  /** Switch the language now. `persistToAccount` also saves it to the DB (used
   * from the in-app settings; the logged-out login screen keeps it local). */
  async setLanguage(lang: string, persistToAccount = false): Promise<void> {
    if (!isSupported(lang)) return;
    this.apply(lang);
    if (persistToAccount) await this.saveToAccount(lang);
  }

  /**
   * Reconcile with a just-authenticated account (login / session restore):
   * adopt the account's language, or — if it has none yet — persist the current
   * local selection as the account's language (no default is invented).
   */
  async applyFromAccount(user: User): Promise<void> {
    if (isSupported(user.language)) {
      if (user.language !== this.current()) this.apply(user.language);
    } else {
      await this.saveToAccount(this.current());
    }
  }

  private apply(lang: string): void {
    this.translate.use(lang);
    this.current.set(lang);
    localStorage.setItem(LANG_KEY, lang);
    configureFormat((key, params) => this.translate.instant(key, params) as string, lang);
  }

  private async saveToAccount(lang: string): Promise<void> {
    try {
      await firstValueFrom(this.http.patch('/api/users/me', { language: lang }));
    } catch {
      // Offline — the account stays as-is and re-syncs on the next login.
    }
  }

  /**
   * First-run language: a previously stored choice wins; otherwise fall back to
   * the browser's preferred languages (first supported match), and only then to
   * English if the browser offers nothing we support.
   */
  private initialLanguage(): string {
    const stored = localStorage.getItem(LANG_KEY);
    if (isSupported(stored)) return stored;
    return this.detectBrowserLanguage() ?? DEFAULT_LANGUAGE;
  }

  private detectBrowserLanguage(): string | null {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const pref of prefs) {
      const base = pref?.split('-')[0]?.toLowerCase(); // "de-DE" → "de"
      if (isSupported(base)) return base;
    }
    return null;
  }
}
