// Demo mode swaps this in for '@/realtime/socket' (see vite.config.ts): the test stand-in for
// Socket.IO, answering room joins and pushing new readings for online devices every few seconds.
import { fakeSocket } from '@/test/fake-socket';
import { devices, keysOf, latestOf } from './fixtures';

export { getSocket, useDeviceRooms, useRoomSubscription, useSocketEvent } from '@/test/fake-socket';

const TICK_MS = 4000;

setInterval(() => {
  fakeSocket.answerRooms();
  const t = Date.now();
  for (const d of devices) {
    if (d.status !== 'online') continue;
    fakeSocket.serverEmit('telemetry', { deviceId: d.id, values: latestOf(d, keysOf(d.profileId).map((k) => k.key), t) });
  }
}, TICK_MS);
