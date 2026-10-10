import type { DeviceDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DEVICE_LISTS } from '@/realtime/hooks';

/** A customer adds a device with the claim code that came with it. */
export function ClaimDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const device = await api<DeviceDto>('/devices/claim', { body: { code, ...(name.trim() ? { name: name.trim() } : {}) } });
      await qc.invalidateQueries({ queryKey: DEVICE_LISTS });
      onOpenChange(false);
      setCode('');
      setName('');
      void navigate(`/devices/${device.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a device with its claim code</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Claim code" help="12 letters and digits, e.g. ABCD-EFGH-JKMN.">
            {(id, d) => <Input id={id} aria-describedby={d} required autoComplete="off" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Field label="Name" help="Optional; keeps the device's name when empty.">
            {(id, d) => <Input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit">Add device</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
