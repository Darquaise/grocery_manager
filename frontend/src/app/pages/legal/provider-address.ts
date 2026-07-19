import { Component, input } from '@angular/core';

import { LegalInfo } from '../../services/legal';

/** The provider's postal address — identical on the imprint and privacy pages. */
@Component({
  selector: 'app-provider-address',
  template: `
    <address class="space-y-1 text-[17px] not-italic">
      <p>{{ info().name }}</p>
      @if (info().care_of) {
        <p>{{ info().care_of }}</p>
      }
      <p>{{ info().street }}</p>
      <p>{{ info().city }}</p>
      @if (info().country) {
        <p>{{ info().country }}</p>
      }
    </address>
  `,
})
export class ProviderAddress {
  readonly info = input.required<LegalInfo>();
}
