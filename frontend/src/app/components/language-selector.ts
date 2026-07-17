import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { LANGUAGES, flagUrl, languageDef } from '../i18n/languages';
import { LanguageService } from '../services/language';

/**
 * Flag trigger + language picker. Two triggers via `variant`:
 *   - `icon` (default): a round flag button (login screen, top-right).
 *   - `row`: a full-width settings row showing the current language.
 *
 * The picker is a full-screen sheet on phones and a small popup pinned to the
 * top-right corner on wider screens. `persist` mirrors the choice to the
 * account (used once logged in; the login screen keeps it local only).
 */
@Component({
  selector: 'app-language-selector',
  imports: [TranslatePipe],
  template: `
    @if (variant() === 'row') {
      <button
        type="button"
        (click)="open.set(true)"
        class="ios-card flex w-full items-center gap-3 p-4 text-left active:bg-surface-press"
      >
        <span class="flex-1 text-[17px]">{{ 'settings.language' | translate }}</span>
        <img [src]="flagUrl(currentDef())" alt="" class="h-4 w-[21px] shrink-0 rounded-[3px] object-cover ring-1 ring-black/10" />
        <span class="text-[15px] text-label-2">{{ currentDef().name }}</span>
        <svg class="h-4 w-4 shrink-0 text-label-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
        </svg>
      </button>
    } @else {
      <button
        type="button"
        (click)="open.set(true)"
        [attr.aria-label]="'language.title' | translate"
        class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10 active:opacity-80"
      >
        <img [src]="flagUrl(currentDef())" alt="" class="h-full w-full object-cover" />
      </button>
    }

    @if (open()) {
      <button
        type="button"
        (click)="open.set(false)"
        [attr.aria-label]="'shopping.close' | translate"
        class="fixed inset-0 z-40 bg-black/25"
      ></button>

      <div
        role="dialog"
        aria-modal="true"
        class="fixed inset-0 z-50 flex flex-col bg-bg pt-[env(safe-area-inset-top)]
               sm:inset-auto sm:right-3 sm:top-3 sm:w-72 sm:rounded-[18px] sm:border sm:border-separator sm:bg-surface sm:pt-0 sm:shadow-2xl"
      >
        <header class="flex items-center justify-between px-4 py-3.5 sm:border-b sm:border-separator">
          <span class="text-headline font-semibold">{{ 'language.title' | translate }}</span>
          <button
            type="button"
            (click)="open.set(false)"
            [attr.aria-label]="'shopping.close' | translate"
            class="flex h-8 w-8 items-center justify-center rounded-full bg-fill text-label-2 active:bg-surface-press"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <ul class="overflow-y-auto sm:py-1">
          @for (l of languages; track l.code) {
            <li>
              <button
                type="button"
                (click)="choose(l.code)"
                class="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-surface-press"
              >
                <img [src]="flagUrl(l)" alt="" class="h-6 w-8 shrink-0 rounded-[4px] object-cover ring-1 ring-black/10" />
                <span class="flex-1 text-[17px]">{{ l.name }}</span>
                @if (l.code === current()) {
                  <svg class="h-5 w-5 text-tint" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4 10-11" />
                  </svg>
                }
              </button>
            </li>
          }
        </ul>
      </div>
    }
  `,
})
export class LanguageSelector {
  /** `icon` = round flag button; `row` = full-width settings row. */
  readonly variant = input<'icon' | 'row'>('icon');
  /** Also persist the choice to the logged-in account. */
  readonly persist = input(false);

  private lang = inject(LanguageService);
  protected readonly languages = LANGUAGES;
  protected readonly flagUrl = flagUrl;

  protected readonly current = this.lang.current;
  protected readonly currentDef = computed(() => languageDef(this.current()));

  protected readonly open = signal(false);

  choose(code: string): void {
    void this.lang.setLanguage(code, this.persist());
    this.open.set(false);
  }
}
