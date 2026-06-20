import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // With a cached user, let the app in immediately and re-verify in the
  // background (offline-friendly; fetchMe only logs out on a real 401).
  if (auth.user()) {
    void auth.fetchMe();
    return true;
  }
  const user = await auth.fetchMe();
  return user ? true : router.createUrlTree(['/login']);
};
