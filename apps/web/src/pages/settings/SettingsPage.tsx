import { NavLink, Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { BrandingSettings } from './BrandingSettings';
import { EmailSettings } from './EmailSettings';
import { ProfileSettings } from './ProfileSettings';
import { SecuritySettings } from './SecuritySettings';

export function SettingsPage() {
  const { hasPerm } = useAuth();
  const tabs = [
    { to: 'profile', label: 'My profile', show: true },
    { to: 'branding', label: 'Branding', show: hasPerm('branding.edit') },
    { to: 'email', label: 'Email', show: hasPerm('system.settings') },
    { to: 'security', label: 'Security', show: hasPerm('system.settings') },
  ].filter((t) => t.show);
  return (
    <div>
      <PageHeader title="Settings" />
      <nav aria-label="Settings" className="mb-6 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300',
                isActive && 'border-primary-600 text-primary-700 dark:text-primary-300',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<ProfileSettings />} />
        {hasPerm('branding.edit') && <Route path="branding" element={<BrandingSettings />} />}
        {hasPerm('system.settings') && <Route path="email" element={<EmailSettings />} />}
        {hasPerm('system.settings') && <Route path="security" element={<SecuritySettings />} />}
        <Route path="*" element={<Navigate to="profile" replace />} />
      </Routes>
    </div>
  );
}
