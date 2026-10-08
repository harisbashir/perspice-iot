const SECRET_KEY = /password|token|secret|totp/i;

/** Deep-copies a request body, replacing values whose key looks secret with "[redacted]". */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}
