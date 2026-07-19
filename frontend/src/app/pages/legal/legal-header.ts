import { Component, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

/** Shared header for the imprint and privacy pages. */
@Component({
  selector: 'app-legal-header',
  imports: [TranslatePipe],
  template: `
    <header class="flex items-center gap-2 px-4 pb-2 pt-3">
      <button (click)="back()" class="-ml-2 p-2 text-tint" [attr.aria-label]="'legal.back' | translate">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>
      <h1 class="text-largetitle font-bold">{{ title() }}</h1>
    </header>
  `,
})
export class LegalHeader {
  private location = inject(Location);
  readonly title = input.required<string>();

  back(): void {
    this.location.back();
  }
}
