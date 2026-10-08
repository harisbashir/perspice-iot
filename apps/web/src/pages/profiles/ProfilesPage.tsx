import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProfiles } from '../devices/hooks';

export function ProfilesPage() {
  const { hasPerm } = useAuth();
  const { data = [] } = useProfiles();
  return (
    <div>
      <PageHeader
        title="Device profiles"
        description="Telemetry keys, commands and presence rules shared by devices of the same kind."
        actions={
          hasPerm('profile.write') && (
            <Button asChild>
              <Link to="/profiles/new">
                <Plus className="h-4 w-4" /> New profile
              </Link>
            </Button>
          )
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Transport</TableHead>
            <TableHead>Keys</TableHead>
            <TableHead>Commands</TableHead>
            <TableHead>Offline after</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <Link to={`/profiles/${p.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                  {p.name}
                </Link>
              </TableCell>
              <TableCell className="uppercase">{p.transport}</TableCell>
              <TableCell>{p.telemetrySchema.length}</TableCell>
              <TableCell>{p.commands.length}</TableCell>
              <TableCell>{p.offlineTimeoutS}s</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
