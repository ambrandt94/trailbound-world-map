import { Routes } from '@angular/router';
import { ShellComponent } from './components/shell/shell.component';

export const routes: Routes = [
  { path: '', component: ShellComponent },
  { path: '**', redirectTo: '' },
];
