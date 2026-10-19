import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ListTree } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { formatValue, keyDef, timeAgo } from '../../data/format';
import { dataOf, isList } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { StatusPill } from './StatusPill';
import { row, td, th, wideOnly } from './styles';

const schema = z.object({ linkToDevice: field.boolean('Open the device dashboard on click').default(true) });
type Settings = z.infer<typeof schema>;

const BUILT_IN: Record<string, string> = { status: 'Status', name: 'Name', profile: 'Profile', customer: 'Customer', lastSeen: 'Last seen' };
/** Columns kept on a narrow widget: the name, the status, and the first other column configured. */
const secondaryOf = (columns: string[]) => {
  const keep = new Set(['name', 'status', columns.find((c) => c !== 'name' && c !== 'status')]);
  return (c: string) => !keep.has(c);
};

export const entityTable: WidgetDefinition<Settings> = {
  type: 'entity-table',
  name: 'Device table',
  description: 'Devices with status, last seen and chosen values; sortable and paginated.',
  icon: ListTree,
  category: 'table',
  settingsSchema: schema,
  data: { mode: 'list', sources: ['entityList'] },
  defaultSize: { w: 12, h: 10 },
  Component: ({ config, settings, result, profile, viewer, actions }) => {
    const data = dataOf(result);
    const ds = config.datasource.kind === 'entityList' ? config.datasource : null;
    const columns = (ds?.columns ?? []).filter((c) => !(c === 'customer' && viewer.scopeType === 'customer'));
    const secondary = secondaryOf(columns);
    const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' } | null>(null);
    const [customerId, setCustomerId] = useState('');
    const list = isList(data) ? data : null;

    function sortBy(by: string) {
      const next = { by, dir: sort?.by === by && sort.dir === 'asc' ? ('desc' as const) : ('asc' as const) };
      setSort(next);
      actions.setQuery({ sort: next });
    }

    const from = list ? list.page * list.pageSize + 1 : 0;
    const to = list ? list.page * list.pageSize + list.items.length : 0;

    return (
      <WidgetStatus result={result}>
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className={`${th} ${secondary(c) ? wideOnly : ''}`} aria-sort={sort?.by === c ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => sortBy(c)}>
                        {BUILT_IN[c] ?? keyDef(profile, c)?.label ?? c}
                        {sort?.by === c && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list?.items.map((item) => (
                  <tr key={item.id} className={row}>
                    {columns.map((c) => (
                      <td key={c} className={`${td} ${secondary(c) ? wideOnly : ''}`}>
                        {c === 'status' ? (
                          <StatusPill status={item.status} />
                        ) : c === 'name' ? (
                          settings.linkToDevice ? (
                            <a
                              href={`/devices/${item.id}`}
                              className="font-medium text-primary-700 hover:underline dark:text-primary-300"
                              onClick={(e) => {
                                e.preventDefault();
                                actions.openDevice(item.id);
                              }}
                            >
                              {item.name}
                            </a>
                          ) : (
                            item.name
                          )
                        ) : c === 'profile' ? (
                          item.profileName ?? '—'
                        ) : c === 'customer' ? (
                          item.customerName ?? '—'
                        ) : c === 'lastSeen' ? (
                          <span title={item.lastSeen ? new Date(item.lastSeen).toLocaleString() : undefined}>{timeAgo(item.lastSeen)}</span>
                        ) : (
                          <span className="tabular-nums">{formatValue(item.values[c]?.v, keyDef(profile, c))}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list && (
            <div className="flex items-center justify-end gap-2 pt-1 text-xs text-fg-muted">
              {viewer.scopeType === 'platform' && (list.customers?.length || customerId) ? (
                <select
                  aria-label="Filter by customer"
                  className="mr-auto h-7 rounded-md border border-line-strong bg-surface px-2 text-xs"
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    actions.setQuery({ customerId: e.target.value || undefined, page: 0 });
                  }}
                >
                  <option value="">All customers</option>
                  {list.customers?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <span>{list.total ? `${from}–${to} of ${list.total}` : 'No devices'}</span>
              <button type="button" aria-label="Previous page" disabled={list.page === 0} className="grid h-7 w-7 place-items-center rounded-md hover:bg-fill disabled:opacity-40 touch:h-9 touch:w-9" onClick={() => actions.setQuery({ page: list.page - 1 })}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Next page" disabled={to >= list.total} className="grid h-7 w-7 place-items-center rounded-md hover:bg-fill disabled:opacity-40 touch:h-9 touch:w-9" onClick={() => actions.setQuery({ page: list.page + 1 })}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </WidgetStatus>
    );
  },
};
