import { NavLink, Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { ApiKeySettings } from './ApiKeySettings';
import { BrandingSettings } from './BrandingSettings';
import { DeliveryLogSettings } from './DeliveryLogSettings';
import { EmailSettings } from './EmailSettings';
import { NotificationSettings } from './NotificationSettings';
import { ProfileSettings } from './ProfileSettings';
import { SecuritySettings } from './SecuritySettings';
import { WebhookSettings } from './WebhookSettings';
import { MapSettings } from './MapSettings';
import { TariffSettings } from './TariffSettings';

export function SettingsPage() {
  const { hasPerm } = useAuth();
  const tabs = [
    { to: 'profile', label: 'My profile', show: true },
    { to: 'notifications', label: 'Notifications', show: true },
    { to: 'branding', label: 'Branding', show: hasPerm('branding.edit') },
    { to: 'webhooks', label: 'Webhooks', show: hasPerm('webhook.manage') },
    { to: 'api-keys', label: 'API keys', show: true },
    { to: 'tariff', label: 'Energy tariff', show: hasPerm('tariff.manage') },
    { to: 'deliveries', label: 'Delivery log', show: hasPerm('audit.read') },
    { to: 'email', label: 'Email', show: hasPerm('system.settings') },
    { to: 'security', label: 'Security', show: hasPerm('system.settings') },
    { to: 'maps', label: 'Maps', show: hasPerm('system.settings') },
  ].filter((t) => t.show);
  return (
    <div>
      <PageHeader title="Settings" />
      <nav aria-label="Settings" className="mb-6 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            // Absolute: inside this splat route a relative link resolves against the current tab
            // (/settings/profile/maps), which fell through to the catch-all redirect in a loop.
            to={`/settings/${t.to}`}
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
        <Route index element={<Navigate to="/settings/profile" replace />} />
        <Route path="profile" element={<ProfileSettings />} />
        <Route path="notifications" element={<NotificationSettings />} />
        {hasPerm('branding.edit') && <Route path="branding" element={<BrandingSettings />} />}
        {hasPerm('webhook.manage') && <Route path="webhooks" element={<WebhookSettings />} />}
        <Route path="api-keys" element={<ApiKeySettings />} />
        {hasPerm('tariff.manage') && <Route path="tariff" element={<TariffSettings />} />}
        {hasPerm('audit.read') && <Route path="deliveries" element={<DeliveryLogSettings />} />}
        {hasPerm('system.settings') && <Route path="email" element={<EmailSettings />} />}
        {hasPerm('system.settings') && <Route path="security" element={<SecuritySettings />} />}
        {hasPerm('system.settings') && <Route path="maps" element={<MapSettings />} />}
        <Route path="*" element={<Navigate to="/settings/profile" replace />} />
      </Routes>
    </div>
  );
}
