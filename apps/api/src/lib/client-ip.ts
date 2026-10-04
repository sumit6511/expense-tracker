import { BlockList, isIP } from 'node:net';

/**
 * Who is on the other end of a request. Rate limits (ours and Better Auth's sign-in limits) and
 * the "where you're signed in" list need the client's address, but `X-Forwarded-For` is just a
 * header: anyone can send one. So the address comes from the TCP connection, and the header is
 * only believed when that connection is from a proxy we trust (TRUST_PROXY).
 */

/** Set by the server on requests it hands to Better Auth; a value sent by a client is replaced. */
export const CLIENT_IP_HEADER = 'x-et-client-ip';

const NAMED_RANGES: Record<string, Array<[string, number, 'ipv4' | 'ipv6']>> = {
  loopback: [
    ['127.0.0.0', 8, 'ipv4'],
    ['::1', 128, 'ipv6'],
  ],
  // RFC 1918 and unique local addresses: Docker networks, LANs, most tunnels' local hop.
  private: [
    ['10.0.0.0', 8, 'ipv4'],
    ['172.16.0.0', 12, 'ipv4'],
    ['192.168.0.0', 16, 'ipv4'],
    ['fc00::', 7, 'ipv6'],
  ],
  linklocal: [
    ['169.254.0.0', 16, 'ipv4'],
    ['fe80::', 10, 'ipv6'],
  ],
};

/**
 * The proxies whose `X-Forwarded-For` we believe, from TRUST_PROXY entries: `loopback`,
 * `private`, `linklocal`, addresses and CIDR ranges, or `none`. Throws on anything else.
 */
export function trustedProxies(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const raw of entries) {
    const entry = raw.trim().toLowerCase();
    if (!entry || entry === 'none') continue;
    const named = NAMED_RANGES[entry];
    if (named) {
      for (const [net, prefix, family] of named) list.addSubnet(net, prefix, family);
      continue;
    }
    const [address = '', prefixText] = entry.split('/');
    const family = isIP(address);
    const max = family === 4 ? 32 : 128;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (!family || !Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      throw new Error(`TRUST_PROXY: "${raw}" is not an address, a CIDR range or a known name`);
    }
    list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

/** "::ffff:203.0.113.5" → "203.0.113.5"; anything that isn't an IP address → null. */
function normalize(address: string | undefined): string | null {
  const value = address?.trim().replace(/^\[|\]$/g, '');
  if (!value) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  const ip = mapped ? mapped[1]! : value;
  return isIP(ip) ? ip.toLowerCase() : null;
}

const isTrusted = (trusted: BlockList, ip: string) =>
  trusted.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');

/**
 * The client's address. Starting from the connection, each trusted proxy hop is replaced by the
 * address it says it forwarded for (right to left through `X-Forwarded-For`), stopping at the
 * first address that isn't a trusted proxy. Entries further left were written by the client and
 * are never used. Null only when there's no connection to look at (in-process tests).
 */
export function clientIp(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  trusted: BlockList,
): string | null {
  let current = normalize(socketAddress);
  if (!current || !forwardedFor) return current;
  const hops = forwardedFor.split(',');
  while (isTrusted(trusted, current) && hops.length > 0) {
    const next = normalize(hops.pop());
    // A garbled entry can only have come from the client's side; keep the last good hop.
    if (!next) break;
    current = next;
  }
  return current;
}
