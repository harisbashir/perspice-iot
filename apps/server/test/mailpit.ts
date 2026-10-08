import { inject } from 'vitest';
import { SettingsService } from '../src/settings/settings.service';
import type { TestApp } from './harness';

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function configureMailpit(t: TestApp): Promise<void> {
  const smtp = inject('mailpitSmtp');
  const settings = t.app.get(SettingsService);
  await settings.set('email.driver', 'smtp');
  await settings.set(
    'email.smtp',
    { host: smtp.host, port: smtp.port, secure: false, user: '', pass: '', from: 'Perspice <no-reply@perspice.test>' },
    { secret: true },
  );
}

export async function clearMailpit(): Promise<void> {
  await fetch(`${inject('mailpitApiUrl')}/api/v1/messages`, { method: 'DELETE' });
}

export async function listMail(to: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${inject('mailpitApiUrl')}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const body = (await res.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

export async function waitForMail(to: string, timeoutMs = 10_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [msg] = await listMail(to);
    if (msg) return msg;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}

/** Fetches the plain-text body of a message (e.g. to extract links). */
export async function mailText(id: string): Promise<string> {
  const res = await fetch(`${inject('mailpitApiUrl')}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text: string };
  return body.Text;
}
