/**
 * Web Push in the browser: asking permission, subscribing this device with the server's key,
 * and unsubscribing. The service worker (public/push-sw.js) shows what arrives.
 */

export type PushSupport = 'supported' | 'unsupported';

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  return 'supported';
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** This device's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function keyBytes(base64url: string) {
  const base64 = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) =>
  !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

export class PushError extends Error {}

/** Asks permission (if needed) and subscribes this device. */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscriptionJSON> {
  const reg = await registration();
  if (!reg) throw new PushError('Reload the app once so it can finish installing, then try again.');
  const permission = await Notification.requestPermission();
  if (permission === 'denied')
    throw new PushError(
      'Notifications are blocked for this site. Allow them in your browser’s site settings.',
    );
  if (permission !== 'granted') throw new PushError('Notifications weren’t allowed.');
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Made with another server key (the server's keys changed): start over.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub.toJSON();
}

/** Unsubscribes this device; returns the endpoint it had. */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const { endpoint } = sub;
  await sub.unsubscribe();
  return endpoint;
}

/** "Chrome on Android", "Safari on iPhone": enough to tell devices apart. */
export function deviceLabel(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /iPad/.test(ua)
        ? 'iPad'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return os ? `${browser} on ${os}` : browser;
}
