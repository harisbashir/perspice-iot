import { type RouteObject, createBrowserRouter } from 'react-router';
import { ActivatePage } from './auth/ActivatePage';
import { ForgotPage } from './auth/ForgotPage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth, RequirePermission } from './auth/RequirePermission';
import { ResetPage } from './auth/ResetPage';
import { AppShell } from './layout/AppShell';
import { NotFoundPage } from './pages/NotFoundPage';
import { Placeholder } from './pages/Placeholder';
import { AuditPage } from './pages/audit/AuditPage';
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { RolesPage } from './pages/roles/RolesPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { UsersPage } from './pages/users/UsersPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot', element: <ForgotPage /> },
  { path: '/reset', element: <ResetPage /> },
  { path: '/activate', element: <ActivatePage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Placeholder title="Overview" /> },
      { path: 'devices', element: <RequirePermission perm="device.read"><Placeholder title="Devices" /></RequirePermission> },
      { path: 'devices/:id', element: <RequirePermission perm="device.read"><Placeholder title="Device" /></RequirePermission> },
      { path: 'profiles', element: <RequirePermission perm="profile.read"><Placeholder title="Device profiles" /></RequirePermission> },
      { path: 'customers', element: <RequirePermission perm="customer.read"><CustomersPage /></RequirePermission> },
      { path: 'customers/:id', element: <RequirePermission perm="customer.read"><CustomerDetailPage /></RequirePermission> },
      { path: 'users', element: <RequirePermission perm="user.read"><UsersPage /></RequirePermission> },
      { path: 'roles', element: <RequirePermission perm="user.read"><RolesPage /></RequirePermission> },
      { path: 'audit', element: <RequirePermission perm="audit.read"><AuditPage /></RequirePermission> },
      { path: 'settings/*', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
