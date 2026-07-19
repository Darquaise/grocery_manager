import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { LegalService } from '../../services/legal';
import { LegalHeader } from './legal-header';
import { ProviderAddress } from './provider-address';

@Component({
  selector: 'app-privacy',
  imports: [TranslatePipe, LegalHeader, ProviderAddress],
  template: `
    <app-legal-header [title]="'privacy.title' | translate" />

    <div class="space-y-5 px-4 pb-4">
      @if (info(); as legal) {
        @if (legal.configured) {
          <section class="ios-card p-4">
            <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'privacy.controller' | translate }}</h2>
            <app-provider-address [info]="legal" />
            @if (legal.email) {
              <a [href]="'mailto:' + legal.email" class="mt-2 block text-[17px] text-tint">{{ legal.email }}</a>
            }
          </section>
        }

        <!-- Hosting names the Art. 28 processor; without one configured the
             section stays generic rather than showing an empty name. -->
        <section class="ios-card p-4">
          <h2 class="pb-3 text-[13px] font-semibold text-label-2">{{ 'privacy.hosting.title' | translate }}</h2>
          <p class="whitespace-pre-line text-[15px] leading-relaxed text-label-2">
            {{
              (legal.hosting_provider ? 'privacy.hosting.text' : 'privacy.hosting.textGeneric')
                | translate: { provider: legal.hosting_provider }
            }}
          </p>
        </section>
      }

      @for (section of sections; track section) {
        <section class="ios-card p-4">
          <h2 class="pb-3 text-[13px] font-semibold text-label-2">
            {{ 'privacy.' + section + '.title' | translate }}
          </h2>
          <p class="whitespace-pre-line text-[15px] leading-relaxed text-label-2">
            {{ 'privacy.' + section + '.text' | translate }}
          </p>
        </section>
      }
    </div>
  `,
})
export class Privacy {
  private legal = inject(LegalService);
  protected readonly info = computed(() => this.legal.info());

  /** Instance-independent sections; controller and hosting are rendered above. */
  protected readonly sections = ['data', 'purpose', 'cookies', 'retention', 'rights', 'thirdParties'] as const;

  constructor() {
    void this.legal.load();
  }
}
