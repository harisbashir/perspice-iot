import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function TotpStep({
  busy,
  error,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(code);
      }}
    >
      <Field label="Authentication code" error={error}>
        {(id, describedBy) => (
          <Input
            id={id}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            aria-describedby={describedBy}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
        Verify
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
        Back
      </Button>
    </form>
  );
}
