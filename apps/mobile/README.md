# Android app

The Android app is the web app in a native shell ([Capacitor](https://capacitorjs.com)) that opens
your own server. It adds one thing a browser can't do: **reading bank and wallet alert SMS** from
the phone, so Import → SMS alerts → "Read alerts from this phone" brings them in without copying.
Everything else (signing in, your data, new versions of the app) comes from your server, so the
app doesn't need rebuilding when the server is updated.

Without building anything, you can also install the web app from Chrome (menu → *Install app*):
it works offline, gets push notifications, and accepts receipt photos shared from other apps.
Reading SMS is the only reason to build this app.

## Build it

You need [Android Studio](https://developer.android.com/studio) (or the Android SDK and JDK 21),
Node.js 22+ and pnpm.

```bash
pnpm install
# The address people open in the browser:
SERVER_URL=https://money.example.com pnpm --filter @et/mobile sync
cd apps/mobile/android
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
```

Install the APK on the phone (`adb install app/build/outputs/apk/debug/app-debug.apk`, or copy it
over and open it). For a release build, create a signing key and run `./gradlew assembleRelease`
with it, or use *Build → Generate Signed App Bundle / APK* in Android Studio
(`pnpm --filter @et/mobile open` opens the project there).

| Setting | Purpose |
|---|---|
| `SERVER_URL` | **Required.** Your server, e.g. `https://money.example.com`. Plain `http://` only works for a server on your own network. |
| `APP_ID` | Android application id (default `np.expensetracker.app`). |
| `APP_NAME` | Name under the icon (default `Expense Tracker`). |

## Reading SMS

The app asks for permission to read SMS the first time you tap "Read alerts from this phone". It
only reads (never sends or deletes), only when you ask, and only messages since the last time
(the first time, the last 30 days). Messages that don't look like a transaction (no amount) are
left out, and what's left goes through the same review as pasted alerts: you check them, choose
the account, and duplicates are flagged before anything is imported. The messages are read on the
phone; only the transactions you import reach the server.

Google Play only allows apps that are the default SMS app to read SMS, so this app is meant to be
installed directly (as above), not published on Play.

## Limits

- Push notifications don't work inside the app (Android's WebView has no Web Push); use the web
  app installed from Chrome, or email notifications.
- Passkeys may not be offered inside the app; sign in with your password and two-step code.
- iOS isn't set up: iPhones don't let apps read SMS, so the web app (added to the Home Screen)
  covers everything there.
