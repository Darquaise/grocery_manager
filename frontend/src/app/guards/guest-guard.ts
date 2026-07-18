import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth';

/** The login screen is for logged-out visitors only — an already authenticated
 * user lands on the app instead. Cache-only (no /api/me round trip) so the
 * login form still appears instantly for everyone else; a stale cached user is
 * caught by `authGuard`/`fetchMe` on the target route. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.user() ? router.createUrlTree(['/']) : true;
};
