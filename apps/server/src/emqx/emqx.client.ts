import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config/config';

export interface EmqxClientInfo {
  clientid: string;
  username: string;
  ip_address: string;
  connected: boolean;
  connected_at: string;
}

/** Minimal EMQX 5 REST client (API key auth). */
@Injectable()
export class EmqxClient {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  /** Disconnects a client session; unknown clients are ignored. */
  async kick(clientId: string): Promise<void> {
    const res = await this.request('DELETE', `/api/v5/clients/${encodeURIComponent(clientId)}`);
    if (!res.ok && res.status !== 404) throw new Error(`EMQX kick failed: ${res.status} ${await res.text()}`);
  }

  async listClients(page = 1, limit = 100): Promise<{ data: EmqxClientInfo[]; meta: { count: number } }> {
    const res = await this.request('GET', `/api/v5/clients?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error(`EMQX list clients failed: ${res.status}`);
    return (await res.json()) as { data: EmqxClientInfo[]; meta: { count: number } };
  }

  private request(method: string, path: string): Promise<Response> {
    const auth = Buffer.from(`${this.config.EMQX_API_KEY}:${this.config.EMQX_API_SECRET}`).toString('base64');
    return fetch(`${this.config.EMQX_API_URL}${path}`, {
      method,
      headers: { authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5000),
    });
  }
}
