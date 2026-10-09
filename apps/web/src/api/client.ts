import { ErrorCode, type MeResponse, type Problem } from '@perspice/shared';

/** Fired on window when the API answers 503 MAINTENANCE. */
export const MAINTENANCE_EVENT = 'perspice:maintenance';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Session {
  accessToken: string;
  user: MeResponse;
}

type SessionListener = (session: Session | null) => void;

let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;
const listeners = new Set<SessionListener>();

/** The access token lives only in memory; the refresh token is an HttpOnly cookie. */
export const session = {
  token: () => accessToken,
  set(s: Session | null) {
    accessToken = s?.accessToken ?? null;
    for (const l of listeners) l(s);
  },
  subscribe(l: SessionListener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const apiUrl = (path: string) => `${window.location.origin}/api${path}`;

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<Problem> = {};
  try {
    body = (await res.json()) as Partial<Problem>;
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, body.code ?? ErrorCode.INTERNAL, body.message ?? res.statusText, body.details);
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request
 * (refresh tokens rotate, so two parallel refreshes would look like token reuse).
 */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(apiUrl('/auth/refresh'), { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        session.set(null);
        return null;
      }
      const s = (await res.json()) as Session;
      session.set(s);
      return s;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const url = new URL(apiUrl(path));
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const isForm = opts.body instanceof FormData;
  // Files and other blobs (e.g. a backup to restore) go as raw bytes.
  const isBlob = opts.body instanceof Blob;
  const headers: Record<string, string> = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (isBlob) headers['content-type'] = 'application/octet-stream';
  else if (opts.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  return fetch(url, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : isForm || isBlob ? (opts.body as FormData | Blob) : JSON.stringify(opts.body),
    signal: opts.signal,
  });
}

/** Like `api`, but returns the raw response (file downloads). Throws ApiError when not ok. */
export async function apiResponse(path: string, opts: RequestOptions = {}): Promise<Response> {
  let res = await send(path, opts);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await send(path, opts);
  }
  if (!res.ok) {
    const err = await toError(res);
    // A restore is running: let the app show its maintenance banner.
    if (err.code === ErrorCode.MAINTENANCE) window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT));
    throw err;
  }
  return res;
}

/** JSON API call; on 401 refreshes the session once and retries. Throws ApiError. */
export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await apiResponse(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
