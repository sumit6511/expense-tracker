import { Capacitor, registerPlugin } from '@capacitor/core';
import { storage } from './utils';

/**
 * The Android app (apps/mobile) runs this same web app in a native shell, and adds what a
 * browser can't do: reading bank and wallet alert SMS from the phone's inbox.
 */

export interface PhoneSms {
  id: string;
  sender: string;
  body: string;
  /** Milliseconds since 1970. */
  date: number;
}

interface SmsInboxPlugin {
  read(options: { since?: number; limit?: number }): Promise<{ messages: PhoneSms[] }>;
}

const SmsInbox = registerPlugin<SmsInboxPlugin>('SmsInbox');

/** Running inside the Android app (or another native shell) rather than a browser. */
export const isNativeApp = () => Capacitor.isNativePlatform();

/** Running inside the Android app, where the phone's SMS can be read. */
export const canReadPhoneSms = () =>
  Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('SmsInbox');

const sinceKey = (workspaceId: string) => `et.sms.since.${workspaceId}`;

/**
 * Alert messages received since they were last read for this workspace (at first, the last 30
 * days), newest first. `isAlert` keeps only the ones that look like transactions. Call `done`
 * once they've been imported, so they aren't offered again.
 */
export async function readPhoneAlerts(workspaceId: string, isAlert: (body: string) => boolean) {
  const since = Number(storage.get(sinceKey(workspaceId))) || Date.now() - 30 * 86_400_000;
  const { messages } = await SmsInbox.read({ since, limit: 500 });
  const alerts = messages.filter((m) => isAlert(m.body));
  const newest = Math.max(since, ...messages.map((m) => m.date));
  return {
    alerts,
    done: () => storage.set(sinceKey(workspaceId), String(newest)),
  };
}
