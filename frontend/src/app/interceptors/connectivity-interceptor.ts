import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';

import { ConnectivityService } from '../services/connectivity';

/**
 * Treats real request success/failure as the truth for online state: any
 * response means we're online; a status-0 error (no response reached) means
 * offline. Server errors (4xx/5xx) leave the state untouched.
 */
export const connectivityInterceptor: HttpInterceptorFn = (req, next) => {
  const conn = inject(ConnectivityService);
  return next(req).pipe(
    tap({
      next: () => conn.setOnline(true),
      error: (err) => {
        if (err instanceof HttpErrorResponse && err.status === 0) conn.setOnline(false);
      },
    }),
  );
};
