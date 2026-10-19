import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from '@/api/client';
import type { Page } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useSocketEvent } from '@/realtime/socket';

export interface NotificationDto {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  readAt: number | null;
  createdAt: number;
}

const COUNT = ['notifications', 'unread-count'];
const LIST = ['notifications', 'list'];

export function NotificationsBell() {
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const enabled = hasPerm('notification.read');
  const { data: count } = useQuery({ queryKey: COUNT, queryFn: () => api<{ count: number }>('/notifications/unread-count'), enabled });
  const { data: list } = useQuery({ queryKey: LIST, queryFn: () => api<Page<NotificationDto>>('/notifications', { query: { limit: 10 } }), enabled });

  useSocketEvent<NotificationDto>('notification', (n) => {
    qc.setQueryData<{ count: number }>(COUNT, (c) => ({ count: (c?.count ?? 0) + 1 }));
    qc.setQueryData<Page<NotificationDto>>(LIST, (p) => (p ? { ...p, items: [n, ...p.items].slice(0, 10) } : p));
    toast({ title: n.title, description: n.body, variant: n.severity === 'info' ? 'default' : 'error' });
  });

  if (!enabled) return null;
  const unread = count?.count ?? 0;

  async function open(n: NotificationDto) {
    if (!n.readAt) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.link) navigate(n.link);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${unread} unread)`} className="relative rounded-full">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span data-testid="unread-count" className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-crit-vivid px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-canvas">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
        <div className="flex items-center justify-between">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <Button
              variant="link"
              size="sm"
              onClick={() => void api('/notifications/read-all', { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}
            >
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {(list?.items ?? []).map((n) => (
          <DropdownMenuItem key={n.id} onSelect={() => void open(n)} className="flex-col items-start gap-0.5">
            <span className={n.readAt ? 'text-fg-muted' : 'font-medium'}>
              {!n.readAt && <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary-500 align-middle" />}
              {n.title}
            </span>
            <span className="text-xs text-fg-muted">{new Date(n.createdAt).toLocaleString()}</span>
          </DropdownMenuItem>
        ))}
        {list?.items.length === 0 && <p className="px-2 py-4 text-center text-sm text-fg-muted">You're all caught up.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
