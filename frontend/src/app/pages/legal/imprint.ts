import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { LegalService } from '../../services/legal';
import { LegalHeader } from './legal-header';
import { ProviderAddress } from './provider-address';

@Component({
  selector: 'app-imprint',
  imports: [TranslatePipe, LegalHeader, ProviderAddress],
  template: `
    <app-legal-header [title]="'imprint.title' | translate" />

    <div class="space-y-5 px-4 pb-4">
      @if (info(); as legal) {
        @if (legal.configured) {
          <section class="ios-card p-4">
            <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'imprint.provider' | translate }}</h2>
            <app-provider-address [info]="legal" />
          </section>

          @if (legal.email) {
            <section class="ios-card p-4">
              <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'imprint.contact' | translate }}</h2>
              <a [href]="'mailto:' + legal.email" class="text-[17px] text-tint">{{ legal.email }}</a>
            </section>
          }

          @if (legal.vat_id) {
            <section class="ios-card p-4">
              <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'imprint.vatId' | translate }}</h2>
              <p class="text-[17px]">{{ legal.vat_id }}</p>
            </section>
          }

          <section class="ios-card p-4">
            <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'imprint.disclaimer' | translate }}</h2>
            <p class="text-[15px] leading-relaxed text-label-2">{{ 'imprint.disclaimerText' | translate }}</p>
          </section>
        } @else {
          <section class="ios-card p-4">
            <p class="text-[15px] leading-relaxed text-label-2">{{ 'imprint.notConfigured' | translate }}</p>
          </section>
        }
      }
    </div>
  `,
})
export class Imprint {
  private legal = inject(LegalService);
  protected readonly info = computed(() => this.legal.info());

  constructor() {
    void this.legal.load();
  }
}
