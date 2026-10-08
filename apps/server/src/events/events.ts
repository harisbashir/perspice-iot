interface DeviceEventBase {
  deviceId: string;
  customerId: string | null;
  ts: number;
}

export type DomainEvent =
  | (DeviceEventBase & { type: 'device.deleted' })
  | (DeviceEventBase & { type: 'device.credentials_changed' })
  | (DeviceEventBase & { type: 'device.config_changed'; shared: Record<string, unknown> });

export type DomainEventType = DomainEvent['type'];

export const DEVICE_EVENTS_STREAM = 'events:device';
