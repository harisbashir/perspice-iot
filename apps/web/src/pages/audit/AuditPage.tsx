import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api/client';
import type { AuditEntryDto, Page } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExportMenu } from '@/exports/ExportMenu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function AuditPage() {
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['audit', targetType, targetId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<AuditEntryDto>>('/audit', { query: { targetType: targetType || undefined, targetId: targetId || undefined, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Who did what, and when."
        actions={
          <ExportMenu
            request={(format) => ({ kind: 'audit', format, params: { targetType: targetType || undefined, targetId: targetId || undefined } })}
          />
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Target type" placeholder="Target type (e.g. device)" className="w-56" value={targetType} onChange={(e) => setTargetType(e.target.value)} />
        <Input aria-label="Target id" placeholder="Target id" className="w-80" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-xs">{new Date(r.ts).toLocaleString()}</TableCell>
              <TableCell className="font-mono text-xs">{r.action}</TableCell>
              <TableCell className="text-xs">
                {r.actorType}
                {r.actorId ? ` ${r.actorId.slice(0, 8)}` : ''}
              </TableCell>
              <TableCell className="text-xs">
                {r.targetType}
                {r.targetId ? ` ${r.targetId.slice(0, 8)}` : ''}
              </TableCell>
              <TableCell className="max-w-sm truncate font-mono text-xs text-slate-500">{r.diff ? JSON.stringify(r.diff) : ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {query.hasNextPage && (
        <Button variant="outline" className="mt-4" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}
