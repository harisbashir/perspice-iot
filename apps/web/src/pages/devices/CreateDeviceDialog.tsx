import type { DeviceDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useCustomers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DEVICE_LISTS } from '@/realtime/hooks';
import { TokenDialog } from './CredentialsPanel';
import { useProfiles } from './hooks';

const selectClass = 'h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700';

export function CreateDeviceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const isPlatform = user?.scopeType === 'platform';
  const qc = useQueryClient();
  const { data: profiles = [] } = useProfiles();
  const { data: customers = [] } = useCustomers(isPlatform && open);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ id: string; token: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ device: DeviceDto; token: string }>('/devices', {
        body: {
          name,
          profileId,
          ...(isPlatform && customerId ? { customerId } : {}),
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        },
      });
      await qc.invalidateQueries({ queryKey: DEVICE_LISTS });
      onOpenChange(false);
      setName('');
      setTags('');
      setCreated({ id: res.device.id, token: res.token });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New device</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Profile">
              {(id) => (
                <select id={id} required className={selectClass} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  <option value="" disabled>
                    Choose a profile
                  </option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {isPlatform && (
              <Field label="Customer">
                {(id) => (
                  <select id={id} className={selectClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Tags" help="Comma separated.">
              {(id, d) => <Input id={id} aria-describedby={d} value={tags} onChange={(e) => setTags(e.target.value)} />}
            </Field>
            <ErrorText error={error} />
            <DialogFooter>
              <Button type="submit" disabled={!profileId}>
                Create device
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <TokenDialog deviceId={created?.id ?? ''} token={created?.token ?? null} onClose={() => setCreated(null)} />
    </>
  );
}
