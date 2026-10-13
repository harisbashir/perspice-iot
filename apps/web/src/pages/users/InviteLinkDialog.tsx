import { Check, Copy } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** An activation link to pass on by hand (email may not be set up, or may not arrive). */
export function InviteLinkDialog({ invite, onClose }: { invite: { email: string; link: string } | null; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    input.current?.select();
    try {
      await navigator.clipboard.writeText(invite!.link);
    } catch {
      // No clipboard API outside HTTPS: copy the selected text instead.
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={invite !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share the invite</DialogTitle>
          <DialogDescription>
            Send this link to {invite?.email} to set their password. It's valid for 72 hours, and creating a new one stops
            earlier links from working. An email with the link is sent too when email is set up.
          </DialogDescription>
        </DialogHeader>
        <Field label="Invite link">
          {(id) => <Input id={id} ref={input} readOnly value={invite?.link ?? ''} onFocus={(e) => e.currentTarget.select()} />}
        </Field>
        <DialogFooter>
          <Button type="button" onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
