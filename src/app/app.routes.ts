import { Routes } from '@angular/router';
import { Dashboard } from './dashboard/dashboard';
import { ActiveTrades } from './active-trades/active-trades';

export const routes: Routes = [
  { path: '', component: Dashboard },
  { path: 'active', component: ActiveTrades },
];
