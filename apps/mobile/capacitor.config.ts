import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app opens your own server: build it with SERVER_URL set to the address people
 * use in the browser (e.g. SERVER_URL=https://money.example.com pnpm --filter @et/mobile sync).
 * Signing in, data and updates all come from that server, so the app never needs updating for
 * new versions of the web app.
 */
const serverUrl = process.env.SERVER_URL;
const server = serverUrl ? new URL(serverUrl) : null;

const config: CapacitorConfig = {
  appId: process.env.APP_ID ?? 'np.expensetracker.app',
  appName: process.env.APP_NAME ?? 'Expense Tracker',
  // Shown only when the app was built without SERVER_URL.
  webDir: 'www',
  ...(server && {
    server: {
      url: server.origin,
      // Plain http only for a server on your own network.
      cleartext: server.protocol === 'http:',
      allowNavigation: [server.host],
    },
  }),
  android: {
    allowMixedContent: false,
  },
};

export default config;
