import type { CommandAck } from '@perspice/shared';

/** Marks a device as seen (bound to PresenceService in Task 13). */
export interface PresenceTouch {
  touch(deviceId: string, ts: number): Promise<void>;
}

/** MQTT session lifecycle from EMQX `$SYS` client events (bound to PresenceService). */
export interface SessionEvents {
  onConnected(deviceId: string, connectedAt: number): Promise<void>;
  onDisconnected(deviceId: string, connectedAt: number, reason: string): Promise<void>;
}

/** Command acknowledgements from devices (bound to CommandsService in Task 15). */
export interface AckHandler {
  handleAck(deviceId: string, ack: CommandAck): Promise<void>;
}

export const PRESENCE_TOUCH = Symbol('PRESENCE_TOUCH');
export const SESSION_EVENTS = Symbol('SESSION_EVENTS');
export const ACK_HANDLER = Symbol('ACK_HANDLER');

export const noopPresence: PresenceTouch & SessionEvents = {
  touch: async () => undefined,
  onConnected: async () => undefined,
  onDisconnected: async () => undefined,
};

export const noopAckHandler: AckHandler = { handleAck: async () => undefined };
