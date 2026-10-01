import { createHmac, randomBytes } from 'node:crypto';
import { type LookupAddress, lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Sending webhooks safely. A webhook URL is chosen by a person, so the server must not be
 * usable to reach its own network: addresses are checked when the connection is made (after DNS,
 * so a name can't later switch to a private address), redirects aren't followed, and requests
 * time out.
 */

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
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
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

/** Whether `ip` is on the public internet (not loopback, private, link-local, reserved…). */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !PRIVATE.check(ip, 'ipv4');
  if (family !== 6) return false;
  // IPv4 written as IPv6 (::ffff:10.0.0.1) is judged as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicAddress(mapped[1]!);
  return !PRIVATE.check(ip, 'ipv6');
}

export class WebhookSendError extends Error {}

const blocked = (address: string) =>
  new WebhookSendError(
    `${address} is a private network address; set WEBHOOK_ALLOW_PRIVATE=true to allow it`,
  );

/** A DNS lookup that refuses private addresses (used at connect time). */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad) return callback(blocked(bad.address), []);
    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new WebhookSendError(`No address for ${hostname}`), []);
    callback(null, first.address, first.family);
  });
}

export interface SendResult {
  status: number;
}

export type WebhookSender = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<SendResult>;

export interface SafeResponse {
  status: number;
  body: string;
}

/**
 * An HTTP request to an address someone gave us: private addresses refused (unless allowed),
 * no redirects, a timeout, and at most `maxBytes` of response kept.
 */
export function safeRequest(
  url: string,
  {
    method = 'GET',
    headers = {},
    body,
    allowPrivate,
    timeoutMs = 10_000,
    maxBytes = 0,
  }: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    allowPrivate: boolean;
    timeoutMs?: number;
    /** Response bytes to keep (0 = drain and ignore the body). */
    maxBytes?: number;
  },
): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    // Literal addresses skip DNS, so check them here.
    if (!allowPrivate && isIP(host) && !isPublicAddress(host)) return reject(blocked(host));
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(
      target,
      {
        method,
        headers: { ...headers, 'content-length': Buffer.byteLength(body ?? '') },
        timeout: timeoutMs,
        ...(allowPrivate ? {} : { lookup: guardedLookup as never }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (maxBytes <= 0) return;
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new WebhookSendError('The response was too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () =>
      req.destroy(new WebhookSendError(`No answer within ${timeoutMs / 1000} seconds`)),
    );
    req.on('error', reject);
    req.end(body ?? '');
  });
}

/** POSTs `body` and resolves with the response status (any status; network errors reject). */
export function httpSender({
  allowPrivate,
  timeoutMs = 10_000,
}: {
  allowPrivate: boolean;
  timeoutMs?: number;
}): WebhookSender {
  return async (url, body, headers) => {
    const { status } = await safeRequest(url, {
      method: 'POST',
      headers,
      body,
      allowPrivate,
      timeoutMs,
    });
    return { status };
  };
}

/** A new signing secret in the Standard Webhooks format. */
export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString('base64')}`;
}

/** The `webhook-signature` header value for a message (Standard Webhooks, v1 = HMAC-SHA256). */
export function signWebhook(secret: string, msgId: string, timestamp: number, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${msgId}.${timestamp}.${body}`).digest('base64')}`;
}
