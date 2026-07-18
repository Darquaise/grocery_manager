import { Routes } from '@angular/router';

import { authGuard } from './guards/auth-guard';
import { guestGuard } from './guards/guest-guard';
import { kitchenGuard } from './guards/kitchen-guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: 'setup',
        loadComponent: () => import('./pages/setup/setup').then((m) => m.Setup),
      },
      {
        path: '',
        canActivate: [kitchenGuard],
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/inventory/inventory').then((m) => m.Inventory),
          },
          {
            path: 'products/new',
            loadComponent: () =>
              import('./pages/product-detail/product-detail').then((m) => m.ProductDetail),
          },
          {
            path: 'products/:id',
            loadComponent: () =>
              import('./pages/product-detail/product-detail').then((m) => m.ProductDetail),
          },
          {
            path: 'shopping',
            loadComponent: () => import('./pages/shopping/shopping').then((m) => m.Shopping),
          },
          {
            path: 'archive',
            loadComponent: () => import('./pages/archive/archive').then((m) => m.Archive),
          },
          {
            path: 'settings',
            loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
