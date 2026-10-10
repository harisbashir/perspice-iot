import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { useCustomers } from '@/api/hooks';
import type { CustomerDto } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;
const RESERVED = ['www', 'api', 'admin', 'mqtt', 'app', 'mail'];

export function slugError(slug: string): string | null {
  if (!slug) return null;
  if (!SLUG_PATTERN.test(slug)) return 'Use 3–40 lowercase letters, digits or hyphens.';
  if (RESERVED.includes(slug)) return 'This name is reserved.';
  return null;
}

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export function CreateCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const invalid = slugError(slug);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid || !slug) return;
    try {
      await api<CustomerDto>('/customers', { body: { name, slug } });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      onOpenChange(false);
      setName('');
      setSlug('');
      setSlugTouched(false);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>The subdomain is where the customer's users sign in.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(toSlug(e.target.value));
                }}
              />
            )}
          </Field>
          <Field label="Subdomain" error={invalid} help={slug ? `${slug}.${window.location.hostname}` : undefined}>
            {(id, d) => (
              <Input
                id={id}
                required
                aria-invalid={!!invalid}
                aria-describedby={d}
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={!!invalid || !slug || !name}>
              Create customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CustomersPage() {
  const { hasPerm } = useAuth();
  const { data, isLoading } = useCustomers();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Customers"
        description="Tenants with their own users, devices, branding and subdomain."
        actions={
          hasPerm('customer.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New customer
            </Button>
          )
        }
      />
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Subdomain</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link to={`/customers/${c.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                <TableCell>
                  <Badge variant={c.status === 'active' ? 'success' : 'warning'}>{c.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-slate-500">
                  No customers yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      <CreateCustomerDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
