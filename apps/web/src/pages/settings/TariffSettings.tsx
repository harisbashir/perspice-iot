import { type Tariff, type TariffDto, TariffSchema } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useCustomers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5];
const BLANK: Tariff = { currency: 'EUR', defaultRate: 0, periods: [] };
const cell = 'h-8 text-xs';

/** Energy prices (spec §11): the customer's own tariff, or (platform) the default and each customer's. */
export function TariffSettings() {
  const { user } = useAuth();
  const isPlatform = user?.scopeType === 'platform';
  const qc = useQueryClient();
  const toast = useToast();
  const { data: customers = [] } = useCustomers(isPlatform);
  const [customerId, setCustomerId] = useState('');
  const key = ['tariff', customerId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api<{ tariff: TariffDto | null }>('/tariff', { query: { customerId: customerId || undefined } }) });
  const [draft, setDraft] = useState<Tariff | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (data) {
      const t = data.tariff;
      setDraft(t ? { currency: t.currency, defaultRate: t.defaultRate, periods: t.periods } : BLANK);
    }
  }, [data]);

  if (isLoading || !draft) return <Skeleton className="h-48" />;
  const current = data?.tariff ?? null;
  const parsed = TariffSchema.safeParse(draft);
  const setPeriod = (i: number, patch: Partial<Tariff['periods'][number]>) => setDraft({ ...draft, periods: draft.periods.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const saved = await api<TariffDto>('/tariff', { method: 'PUT', body: { ...draft, ...(customerId ? { customerId } : {}) } });
      qc.setQueryData(key, { tariff: saved });
      toast({ title: 'Tariff saved', variant: 'success' });
    } catch (err) {
      setError(err);
    }
  }

  async function useDefault() {
    setError(null);
    try {
      await api('/tariff', { method: 'DELETE', query: { customerId: customerId || undefined } });
      await qc.invalidateQueries({ queryKey: ['tariff'] });
    } catch (err) {
      setError(err);
    }
  }

  const isDefaultScope = isPlatform && !customerId;
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Energy tariff</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4 text-sm" onSubmit={(e) => void save(e)}>
          {isPlatform && (
            <Field label="Tariff for">
              {(id) => (
                <select id={id} className={selectClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Platform default</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <p className="text-fg-muted" data-testid="tariff-status">
            {isDefaultScope
              ? 'Applies to customers without a tariff of their own, and to unassigned devices.'
              : current?.inherited
                ? 'Using the platform default. Saving creates a tariff of its own.'
                : current
                  ? 'Its own tariff.'
                  : 'No tariff yet: energy is shown without cost.'}
          </p>
          <div className="flex flex-wrap gap-4">
            <Field label="Currency">{(id) => <Input id={id} className="w-24 uppercase" maxLength={3} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} />}</Field>
            <Field label="Price per unit" help="Per kWh (or the unit of the energy key), outside the periods below.">
              {(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="any" className="w-32" value={draft.defaultRate} onChange={(e) => setDraft({ ...draft, defaultRate: Number(e.target.value) })} />}
            </Field>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Time-of-use periods</p>
            <p className="text-xs text-fg-muted">In the customer’s timezone; “to” is exclusive (17–21 is 17:00 to 21:00). The first period that covers an hour applies.</p>
            {draft.periods.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`tariff-period-${i}`}>
                <Input aria-label="Period name" className={`${cell} w-28`} value={p.name} onChange={(e) => setPeriod(i, { name: e.target.value })} />
                <Input aria-label="Period price" type="number" min={0} step="any" className={`${cell} w-24`} value={p.rate} onChange={(e) => setPeriod(i, { rate: Number(e.target.value) })} />
                <div className="flex gap-1" role="group" aria-label="Days">
                  {DAYS.map((d, day) => (
                    <label key={d} className="flex items-center gap-0.5 text-xs">
                      <input
                        type="checkbox"
                        checked={p.days.includes(day)}
                        onChange={(e) => setPeriod(i, { days: e.target.checked ? [...p.days, day].sort() : p.days.filter((x) => x !== day) })}
                      />
                      {d}
                    </label>
                  ))}
                </div>
                <Input aria-label="From hour" type="number" min={0} max={23} className={`${cell} w-16`} value={p.from} onChange={(e) => setPeriod(i, { from: Number(e.target.value) })} />
                <span>–</span>
                <Input aria-label="To hour" type="number" min={1} max={24} className={`${cell} w-16`} value={p.to} onChange={(e) => setPeriod(i, { to: Number(e.target.value) })} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${p.name || 'period'}`} onClick={() => setDraft({ ...draft, periods: draft.periods.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" disabled={draft.periods.length >= 10} onClick={() => setDraft({ ...draft, periods: [...draft.periods, { name: 'Peak', rate: draft.defaultRate, days: WEEKDAYS, from: 17, to: 21 }] })}>
              Add period
            </Button>
          </div>
          {!parsed.success && <p className="text-red-600">{parsed.error.issues[0]?.message}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={!parsed.success}>
              Save
            </Button>
            {!isDefaultScope && current && !current.inherited && (
              <Button type="button" variant="outline" onClick={() => void useDefault()}>
                Use the platform default
              </Button>
            )}
          </div>
          <ErrorText error={error} />
        </form>
      </CardContent>
    </Card>
  );
}
