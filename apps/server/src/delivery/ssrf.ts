import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/** Destinations a webhook may never reach unless the platform allows private networks. */
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can reach IPv4 internals
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, bits, 'ipv6');
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true; // not an address: refuse
}

export interface DestinationPolicy {
  allowHttp: boolean;
  allowPrivate: boolean;
}

export class UnsafeDestinationError extends Error {
  override name = 'UnsafeDestinationError';
}

/** Checks the URL's scheme and that every address its host resolves to is allowed. */
export async function assertSafeUrl(raw: string, policy: DestinationPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeDestinationError('Invalid URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && policy.allowHttp)) {
    throw new UnsafeDestinationError(policy.allowHttp ? 'Use an http(s) URL' : 'Use an https URL');
  }
  if (url.username || url.password) throw new UnsafeDestinationError('URLs with credentials are not allowed');
  if (!policy.allowPrivate) await resolvePublic(url.hostname.replace(/^\[|\]$/g, ''));
  return url;
}

function lookupAll(host: string): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))));
}

async function resolvePublic(host: string): Promise<{ address: string; family: number }[]> {
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookupAll(host).catch(() => {
    throw new UnsafeDestinationError(`Cannot resolve ${host}`);
  });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeDestinationError(`${host} resolves to a private or reserved address`);
  }
  return addrs;
}

/**
 * A `lookup` for http(s).request that re-checks the address at connect time, so a hostname that
 * resolves differently later (DNS rebinding) still can't reach a private address.
 */
export function guardedLookup(policy: DestinationPolicy) {
  return (
    host: string,
    opts: { family?: number; all?: boolean },
    cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
  ): void => {
    const check = policy.allowPrivate ? lookupAll(host) : resolvePublic(host);
    check.then(
      (addrs) => (opts.all ? cb(null, addrs) : cb(null, addrs[0]!.address, addrs[0]!.family)),
      (err: Error) => cb(err, ''),
    );
  };
}
