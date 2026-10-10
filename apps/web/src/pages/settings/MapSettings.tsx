import { type MapTiles, MapTilesSchema } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { resetMapServices } from '@/dashboards/map-services';

/** The tile server map widgets use (its host must also be in MAP_TILE_HOSTS on the server). */
export function MapSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['settings', 'map'], queryFn: () => api<MapTiles>('/settings/map') });
  const [draft, setDraft] = useState<MapTiles | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);
  if (!draft) return <Skeleton className="h-48" />;
  const parsed = MapTilesSchema.safeParse(draft);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      qc.setQueryData(['settings', 'map'], await api<MapTiles>('/settings/map', { method: 'PUT', body: draft }));
      resetMapServices();
      toast({ title: 'Map tiles saved', variant: 'success' });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Maps</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4 text-sm" onSubmit={(e) => void save(e)}>
          <Field label="Tile URL" help="With {z}, {x} and {y} (and {s} for subdomains). Its host must be listed in MAP_TILE_HOSTS on the server.">
            {(id) => <Input id={id} value={draft.urlTemplate} onChange={(e) => setDraft({ ...draft, urlTemplate: e.target.value })} />}
          </Field>
          <Field label="Attribution" help="Shown in the corner of every map, as the tile provider requires.">
            {(id) => <Input id={id} value={draft.attribution} onChange={(e) => setDraft({ ...draft, attribution: e.target.value })} />}
          </Field>
          <Field label="Maximum zoom">
            {(id) => <Input id={id} type="number" min={1} max={22} className="w-24" value={draft.maxZoom} onChange={(e) => setDraft({ ...draft, maxZoom: Number(e.target.value) })} />}
          </Field>
          {!parsed.success && <p className="text-red-600">{parsed.error.issues[0]?.message}</p>}
          <Button type="submit" disabled={!parsed.success}>
            Save
          </Button>
          <ErrorText error={error} />
        </form>
      </CardContent>
    </Card>
  );
}
