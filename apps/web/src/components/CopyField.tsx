import { Check, Copy } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** A read-only value with a Copy button (secrets shown once, links, snippets). */
export function CopyField({
  id,
  value,
  multiline = false,
}: {
  id?: string;
  value: string;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  async function copy() {
    ref.current?.select();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // No clipboard API outside HTTPS: copy the selected text instead.
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  const select = (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => e.currentTarget.select();
  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <textarea
          id={id}
          ref={ref}
          readOnly
          value={value}
          rows={Math.min(14, value.split('\n').length)}
          onFocus={select}
          className="w-full rounded-md border border-line-strong bg-fill p-2 font-mono text-xs"
        />
      ) : (
        <Input id={id} ref={ref} readOnly value={value} onFocus={select} className="font-mono" />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy()}
        aria-label={copied ? 'Copied' : 'Copy'}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
