import type { DeviceDto, DeviceProfileDto } from '@perspice/shared';

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async profile(nameOrId: string): Promise<DeviceProfileDto> {
    const all = await this.request<DeviceProfileDto[]>('/device-profiles');
    const found = all.find((p) => p.id === nameOrId || p.name === nameOrId);
    if (!found) throw new Error(`Profile "${nameOrId}" not found`);
    return found;
  }

  createDevice(name: string, profileId: string): Promise<{ device: DeviceDto; token: string }> {
    return this.request('/devices', { body: { name, profileId, tags: ['simulator'] } });
  }
}
