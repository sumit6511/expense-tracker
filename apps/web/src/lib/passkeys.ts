import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { authApi } from './api';
import { deviceLabel } from './device';

export const passkeysSupported = () => browserSupportsWebAuthn();

/** The person closed the browser's passkey prompt (or it timed out): not worth an error. */
export function isCancelled(err: unknown) {
  return err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

/** A default name for a passkey created on this device, e.g. "Chrome on Android". */
export const passkeyName = (ua = navigator.userAgent) => deviceLabel(ua, 'Passkey');

/** Creates a passkey on this device for the signed-in person. */
export async function addPasskey(name = passkeyName()) {
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
