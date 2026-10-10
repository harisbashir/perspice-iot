import type { NotifyChannel, NotifyLevel } from '@perspice/shared';
import type { EmailTemplateKey } from '../email/templates';

/** One notification, before it is fanned out to users and channels. */
export interface Message {
  /** e.g. `alarm.raised`, `device.offline`, `digest`. */
  type: string;
  level: NotifyLevel;
  title: string;
  body: string;
  /** App-relative link (made absolute for email and push). */
  link: string | null;
  /** The tenant the event belongs to (branding; delivery log visibility). */
  customerId: string | null;
  email?: { template: EmailTemplateKey; vars: Record<string, unknown> };
}

export interface Recipient {
  id: string;
  email: string;
  name: string;
  scopeType: 'platform' | 'customer';
  customerId: string | null;
  customerSlug: string | null;
  /** Effective IANA zone: the user's, else their customer's, else UTC. */
  timezone: string;
}

/** What a channel gets for one delivery. */
export interface Delivery {
  id: string;
  recipient: Recipient;
  message: Message;
  /** Absolute app link for this recipient's portal. */
  url: string | null;
}

export interface NotificationChannel {
  readonly name: NotifyChannel;
  send(d: Delivery): Promise<void>;
}

export const CHANNELS = Symbol('NOTIFICATION_CHANNELS');
