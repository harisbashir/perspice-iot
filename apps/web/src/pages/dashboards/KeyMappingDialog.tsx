import { type DashboardDefinition, type DeviceProfileDto, templateKeys, profileKeys } from '@perspice/shared';
import { type FormEvent, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const selectClass = 'h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700';

/** Keys the template uses that the target profile doesn't declare. */
export function unmatchedKeys(def: DashboardDefinition, target: DeviceProfileDto | null): string[] {
  const known = new Set(profileKeys(target).map((k) => k.key));
  return templateKeys(def).filter((k) => !known.has(k));
}

/** Clone a template, optionally onto another profile, mapping keys the new profile names differently. */
export function CloneDialog({
  open,
  onOpenChange,
  source,
  profiles,
  onClone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: { name: string; definition: DashboardDefinition; profileId: string | null; kind: 'device' | 'overview' };
  profiles: DeviceProfileDto[];
  onClone: (body: { name: string; profileId: string | null; keyMapping: Record<string, string> }) => Promise<void>;
}) {
  const [name, setName] = useState(`${source.name} (copy)`);
  const [profileId, setProfileId] = useState(source.profileId ?? '');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const target = profiles.find((p) => p.id === profileId) ?? null;
  const unmatched = useMemo(() => (source.kind === 'device' ? unmatchedKeys(source.definition, target) : []), [source, target]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await onClone({ name, profileId: source.kind === 'device' ? profileId || null : null, keyMapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)) });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clone dashboard</DialogTitle>
          <DialogDescription>Keys the new profile names differently can be mapped here.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          {source.kind === 'device' && (
            <Field label="Profile">
              {(id) => (
                <select id={id} className={selectClass} value={profileId} onChange={(e) => (setProfileId(e.target.value), setMapping({}))}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {unmatched.length > 0 && (
            <fieldset aria-label="Key mapping" className="space-y-2">
              <legend className="text-sm font-medium">Keys not in {target?.name ?? 'the profile'}</legend>
              {unmatched.map((k) => (
                <Field key={k} label={`Map “${k}” to`}>
                  {(id) => (
                    <select id={id} className={selectClass} value={mapping[k] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value }))}>
                      <option value="">Keep “{k}”</option>
                      {profileKeys(target).map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label} ({t.key})
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ))}
            </fieldset>
          )}
          <DialogFooter>
            <Button type="submit">Clone</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
