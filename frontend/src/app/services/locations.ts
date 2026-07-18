import { Injectable } from '@angular/core';

import { Location } from '../models';
import { NamedListService } from './named-list';

@Injectable({ providedIn: 'root' })
export class LocationsService extends NamedListService<Location> {
  protected readonly kind = 'locations';
}
