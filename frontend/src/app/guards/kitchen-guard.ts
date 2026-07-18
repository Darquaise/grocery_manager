import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { KitchensService } from '../services/kitchens';

/** Kitchen-scoped pages need an active kitchen; without one (fresh account)
 * the user is sent to the setup screen to create or wait for one. */
export const kitchenGuard: CanActivateFn = async () => {
  const kitchens = inject(KitchensService);
  const router = inject(Router);
  // The localStorage mirror makes this instant (and offline-safe) after the
  // first login; only a fresh session actually waits for the request.
  if (kitchens.activeId() != null) return true;
  await kitchens.load();
  return kitchens.activeId() != null ? true : router.createUrlTree(['/setup']);
};
