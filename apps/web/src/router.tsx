import { type RouteObject, createBrowserRouter } from 'react-router';
import { ActivatePage } from './auth/ActivatePage';
import { ForgotPage } from './auth/ForgotPage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth, RequirePermission } from './auth/RequirePermission';
import { ResetPage } from './auth/ResetPage';
import { AppShell } from './layout/AppShell';
import { NotFoundPage } from './pages/NotFoundPage';
import { Placeholder } from './pages/Placeholder';

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
      { path: 'customers', element: <RequirePermission perm="customer.read"><Placeholder title="Customers" /></RequirePermission> },
      { path: 'users', element: <RequirePermission perm="user.read"><Placeholder title="Users" /></RequirePermission> },
      { path: 'audit', element: <RequirePermission perm="audit.read"><Placeholder title="Audit log" /></RequirePermission> },
      { path: 'settings/*', element: <Placeholder title="Settings" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
