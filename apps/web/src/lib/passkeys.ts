import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { authApi } from './api';

export const passkeysSupported = () => browserSupportsWebAuthn();

/** The person closed the browser's passkey prompt (or it timed out): not worth an error. */
export function isCancelled(err: unknown) {
  return err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

/** A default name for a passkey created on this device, e.g. "Chrome on Android". */
export function deviceLabel(ua = navigator.userAgent) {
  const os = /iPhone|iPad/.test(ua)
    ? /iPad/.test(ua)
      ? 'iPad'
      : 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  if (browser && os) return `${browser} on ${os}`;
  return os ?? browser ?? 'Passkey';
}

/** Creates a passkey on this device for the signed-in person. */
export async function addPasskey(name = deviceLabel()) {
  const optionsJSON = await authApi.passkey.registrationOptions();
  const response = await startRegistration({ optionsJSON });
  return authApi.passkey.verifyRegistration(response, name);
}

/** Signs in with a passkey (the browser asks which one). */
export async function signInWithPasskey() {
  const optionsJSON = await authApi.passkey.authenticationOptions();
  const response = await startAuthentication({ optionsJSON });
  return authApi.passkey.verifyAuthentication(response);
}
