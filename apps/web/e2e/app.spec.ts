import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { choose, createUser, expect, test, totp } from './fixtures';

/** Adds today's expenses from Cash through the API, one per payee. */
async function addExpenses(page: Page, workspaceId: string, origin: string, payees: string[]) {
  const base = `/api/v1/workspaces/${workspaceId}`;
  const accounts: Array<{ id: string; name: string }> = await (
    await page.request.get(`${base}/accounts`)
  ).json();
  const cash = accounts.find((a) => a.name === 'Cash')!.id;
  const today = new Date().toISOString().slice(0, 10);
  for (const payee of payees) {
    const res = await page.request.post(`${base}/transactions`, {
      data: { accountId: cash, date: today, amountMinor: -50_000, payee },
      headers: { origin },
    });
    expect(res.ok()).toBeTruthy();
  }
}

test.describe('getting started', () => {
  test('sign up, set up a workspace and record the first expense @mobile', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Sita Sharma');
    await page.getByLabel('Email').fill(`sita-${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { name: /Namaste, Sita/ })).toBeVisible();
    // Defaults: NPR and Bikram Sambat.
    await expect(page.getByLabel('Main currency')).toContainText('NPR');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Cash balance').fill('5,000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Festivals & Gifts')).toBeVisible();
    await page.getByRole('button', { name: 'Start tracking' }).click();

    // The first time, a short tour shows where things are (phones see fewer stops).
    await expect(page.getByRole('heading', { name: 'Welcome, Sita' })).toBeVisible();
    await page.getByRole('button', { name: 'Show me around' }).click();
    const card = page.getByTestId('tour');
    // Step 1 is the welcome, the last one the invitation to add an expense.
    const counter = await card.getByText(/^2 of \d+$/).textContent();
    const total = Number(counter!.split(' of ')[1]);
    for (let n = 2; n < total - 1; n++) {
      await expect(card.getByText(`${n} of ${total}`)).toBeVisible();
      await card.getByRole('button', { name: 'Next' }).click();
    }
    await expect(card.getByText(`${total - 1} of ${total}`)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('heading', { name: 'Ready to start' })).toBeVisible();
    await page.getByRole('button', { name: 'Add first expense' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('250+50');
    await expect(dialog.getByText('= 300.00')).toBeVisible();
    await dialog.getByRole('button', { name: 'Dining Out' }).click();
    await dialog.getByLabel('Payee').fill('Momo Hut');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await expect(page.getByText('Spent this month')).toBeVisible();
    await expect(page.getByText('Rs. 300').first()).toBeVisible();

    // Finished once, it doesn't come back.
    await page.reload();
    await expect(page.getByText('Spent this month')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('tour')).toBeHidden();
  });

  test('signing in and out', async ({ page, baseURL, browser }) => {
    const user = await createUser((await browser.newContext({ baseURL })).request, baseURL!);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Let’s record your first expense')).toBeVisible();

    await page.getByRole('button', { name: 'Asha Test' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('after signing in, only ever continues to a page of this app', async ({
    page,
    baseURL,
    browser,
  }) => {
    const user = await createUser((await browser.newContext({ baseURL })).request, baseURL!);
    // Browsers treat "/\host" like "//host", another site.
    await page.goto(`/login?next=${encodeURIComponent('/\\evil.example/steal')}`);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Let’s record your first expense')).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('source maps aren’t published with the app', async ({ page, request }) => {
    await page.goto('/login');
    const script = await page.locator('script[type="module"][src]').first().getAttribute('src');
    expect(script).toBeTruthy();
    const code = await (await request.get(script!)).text();
    expect(code).not.toContain('sourceMappingURL');
    expect((await request.get(`${script}.map`)).status()).toBe(404);
  });

  test('forgot password: what to do, and an expired link', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password\?email=someone/);
    // This test server has no SMTP, so it explains who can reset the password instead.
    await expect(page.getByText('This server can’t send email')).toBeVisible();
    await expect(page.getByText(/Ask the person who runs this Expense Tracker/)).toBeVisible();

    await page.goto('/reset-password?token=not-a-real-token');
    await page.getByLabel('New password').fill('a-brand-new-password');
    await page.getByLabel('Type it again').fill('a-brand-new-password-typo');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('alert')).toHaveText('The two passwords don’t match.');
    await page.getByLabel('Type it again').fill('a-brand-new-password');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    await page.getByRole('link', { name: 'Send a new link' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });
});

test.describe('account security', () => {
  test('turn on two-step sign-in, then sign in with a code and a backup code', async ({
    signedIn: page,
    user,
    browser,
    baseURL,
  }) => {
    await page.goto('/settings?tab=security');
    await page.getByRole('button', { name: 'Turn on' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Your password').fill(user.password);
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByRole('img', { name: /QR code/ })).toBeVisible();
    const key = await dialog.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).textContent();
    await dialog.getByLabel('6-digit code').fill(totp(key!));
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    const list = dialog.getByRole('list', { name: 'Backup codes' });
    await expect(list).toBeVisible();
    const codes = await list.getByRole('listitem').allTextContents();
    expect(codes).toHaveLength(10);
    await dialog.getByRole('button', { name: 'I’ve saved them' }).click();
    await expect(page.getByText('On', { exact: true })).toBeVisible();

    // Another device: the password alone isn't enough.
    const other = await (await browser.newContext({ baseURL })).newPage();
    await other.goto('/login');
    await other.getByLabel('Email').fill(user.email);
    await other.getByLabel('Password').fill(user.password);
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
    await other.getByLabel('Code from your authenticator app').fill('000000');
    await other.getByRole('button', { name: 'Verify' }).click();
    await expect(other.getByRole('alert')).toHaveText(/didn’t work/);
    await other.getByRole('button', { name: /Use a backup code/ }).click();
    await other.getByLabel('Backup code').fill(codes[0]!);
    await other.getByRole('button', { name: 'Verify' }).click();
    await expect(other.getByText('Let’s record your first expense')).toBeVisible();

    // And with the app's code.
    const third = await (await browser.newContext({ baseURL })).newPage();
    await third.goto('/login');
    await third.getByLabel('Email').fill(user.email);
    await third.getByLabel('Password').fill(user.password);
    await third.getByRole('button', { name: 'Sign in', exact: true }).click();
    await third.getByLabel('Code from your authenticator app').fill(totp(key!));
    await third.getByRole('button', { name: 'Verify' }).click();
    await expect(third.getByText('Let’s record your first expense')).toBeVisible();
  });

  test('add a passkey and sign in with it', async ({ signedIn: page }) => {
    // Chromium's virtual authenticator stands in for Face ID / fingerprint.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto('/settings?tab=security');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.getByText('Passkey added')).toBeVisible();
    const passkeys = page.locator('section', { hasText: 'Sign in with your fingerprint' });
    await expect(passkeys.getByText(/^Chrome on /)).toBeVisible();

    await page.getByRole('button', { name: 'Asha Test' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByText('Let’s record your first expense')).toBeVisible();
  });
});

test.describe('signed-in devices', () => {
  test('see where you’re signed in and sign another device out', async ({
    signedIn: page,
    user,
    browser,
    baseURL,
  }) => {
    // The same person on a second device.
    const other = await browser.newContext({ baseURL });
    const phone = await other.newPage();
    await phone.goto('/login');
    await phone.getByLabel('Email').fill(user.email);
    await phone.getByLabel('Password').fill(user.password);
    await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(phone).not.toHaveURL(/\/login/);

    await page.goto('/settings?tab=security');
    const card = page.locator('section', { hasText: 'Where you’re signed in' });
    await expect(card.getByText('This device')).toBeVisible();
    await expect(card.getByRole('listitem')).toHaveCount(2);
    await card.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByText(/^Signed out /)).toBeVisible();
    await expect(card.getByRole('listitem')).toHaveCount(1);

    await phone.reload();
    await expect(phone).toHaveURL(/\/login/);
    await other.close();
  });
});

test.describe('push notifications', () => {
  test('turn them on for this device; the service worker shows what arrives', async ({
    signedIn: page,
    baseURL,
  }) => {
    await page.context().grantPermissions(['notifications']);
    // A real subscription needs the browser vendor's push service; stand in for it.
    await page.addInitScript(() => {
      const w = window as unknown as { __sub: PushSubscription | null };
      w.__sub = null;
      PushManager.prototype.getSubscription = async () => w.__sub;
      PushManager.prototype.subscribe = async (options) => {
        const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}`;
        w.__sub = {
          endpoint,
          options,
          toJSON: () => ({ endpoint, keys: { p256dh: 'BE2eBrowserKey', auth: 'e2eAuth' } }),
          unsubscribe: async () => {
            w.__sub = null;
            return true;
          },
        } as unknown as PushSubscription;
        return w.__sub;
      };
    });
    await page.goto('/settings?tab=notifications');
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()));
    const toggle = page.getByRole('switch', { name: /On this device/ });
    await toggle.click();
    await expect(page.getByText('Push notifications are on for this device')).toBeVisible();
    await expect(toggle).toBeChecked();
    await expect(page.getByRole('button', { name: 'Send a test' })).toBeVisible();

    // Deliver a push straight to the service worker, once it has finished activating (a push
    // that lands mid-activation can be dropped).
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.ready).active?.state === 'activated',
    );
    const cdp = await page.context().newCDPSession(page);
    const registrationIds = await new Promise<string[]>((resolve) => {
      cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const ours = registrations.filter((r) => !r.isDeleted && r.scopeURL.startsWith(baseURL!));
        if (ours.length) resolve(ours.map((r) => r.registrationId));
      });
      void cdp.send('ServiceWorker.enable');
    });
    const deliver = async () => {
      for (const registrationId of registrationIds) {
        await cdp.send('ServiceWorker.deliverPushMessage', {
          origin: baseURL!,
          registrationId,
          data: JSON.stringify({
            title: 'Rent due tomorrow',
            body: 'Rs. 25,000',
            url: '/recurring',
            tag: 't1',
          }),
        });
      }
    };
    await deliver();
    // A push can still be dropped while the worker starts up: send it again until it shows
    // (the same tag replaces the notification, so there is only ever one).
    await expect
      .poll(async () => {
        const shown = await page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return (await reg!.getNotifications()).map((n) => `${n.title}: ${n.body}`);
        });
        if (shown.length === 0) await deliver();
        return shown;
      })
      .toEqual(['Rent due tomorrow: Rs. 25,000']);

    await toggle.click();
    await expect(toggle).not.toBeChecked();
  });
});

test.describe('sharing', () => {
  test('invite a partner, who signs up from the link and joins', async ({
    signedIn: page,
    browser,
    baseURL,
  }) => {
    const email = `partner-${Date.now()}@example.com`;
    await page.goto('/settings?tab=members');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Invite' }).click();
    const link = await page.getByLabel('Invitation link').inputValue();
    await expect(page.getByText('Waiting to join')).toBeVisible();

    const partner = await (await browser.newContext({ baseURL })).newPage();
    await partner.goto(new URL(link).pathname);
    await expect(partner.getByRole('heading', { name: 'Join “Home”' })).toBeVisible();
    await partner.getByRole('link', { name: 'Create an account' }).click();
    await expect(partner.getByLabel('Email')).toHaveValue(email);
    await partner.getByLabel('Your name').fill('Partner');
    await partner.getByLabel('Password').fill('correct-horse-battery');
    await partner.getByRole('button', { name: 'Create account' }).click();
    await partner.getByRole('button', { name: 'Join “Home”' }).click();
    // New to the app: they get the tour too, and can skip it.
    await partner.getByRole('button', { name: 'Skip tour' }).click();
    await expect(partner.getByText('Let’s record your first expense')).toBeVisible();

    await partner.keyboard.press('n');
    const dialog = partner.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('700');
    await dialog.getByLabel('Payee').fill('Vegetable market');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(partner.getByText('Expense added')).toBeVisible();

    await page.goto('/transactions');
    await expect(page.getByRole('img', { name: 'Added by Partner' })).toBeVisible();
    await choose(page.getByLabel('Added by', { exact: true }), 'Added by Partner');
    await expect(page.getByText('1 transaction', { exact: true })).toBeVisible();
    await page.goto('/settings?tab=members');
    await expect(page.getByLabel('Role for Partner')).toHaveText('Editor');
    await expect(page.getByText('Waiting to join')).toBeHidden();

    // A private account stays the partner's own.
    await partner.goto('/accounts');
    await partner.getByRole('button', { name: 'Add account' }).first().click();
    const form = partner.getByRole('dialog');
    await form.getByLabel('Name').fill('Partner savings');
    await form.getByRole('button', { name: 'Only me' }).click();
    await form.getByRole('button', { name: 'Add account' }).click();
    await expect(partner.getByText('Account added')).toBeVisible();
    await expect(partner.getByText('Partner savings')).toBeVisible();
    await expect(partner.getByLabel('Private: only you can see it')).toBeVisible();
    await page.goto('/accounts');
    await expect(page.getByText('Nabil Bank')).toBeVisible();
    await expect(page.getByText('Partner savings')).toBeHidden();
  });
});

test.describe('split with friends', () => {
  test('share a trip’s costs and settle up', async ({ signedIn: page }) => {
    await page.goto('/split');
    await page.getByRole('button', { name: 'New group' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Name', { exact: true }).fill('Pokhara trip');
    await form.getByLabel('Person 1', { exact: true }).fill('Bikash');
    await form.getByRole('button', { name: 'Add a person' }).click();
    await form.getByLabel('Person 2', { exact: true }).fill('Chandra');
    await form.getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByRole('heading', { name: 'Pokhara trip' })).toBeVisible();

    await page.getByRole('button', { name: 'Add expense' }).click();
    const expense = page.getByRole('dialog');
    await expense.getByLabel('What for').fill('Dinner');
    await expense.getByLabel('Amount').fill('3000');
    await expense.getByRole('switch').click();
    await choose(expense.getByLabel('Paid from'), 'Cash');
    await expense.getByRole('button', { name: 'Add expense' }).click();
    await expect(page.getByText('You’re owed Rs. 2,000')).toBeVisible();
    await expect(page.getByText('you lent Rs. 2,000')).toBeVisible();

    await page.getByRole('button', { name: 'Record', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible();
    await expect(page.getByText('You’re owed Rs. 1,000')).toBeVisible();

    // What was paid from Cash is in the ledger.
    await page.goto('/transactions');
    await expect(page.getByText('Dinner · Pokhara trip')).toBeVisible();
  });
});

test.describe('everyday use', () => {
  test('quick add with the keyboard, edit, delete and undo', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('1,450');
    await dialog.getByRole('button', { name: 'Food & Groceries' }).click();
    await dialog.getByLabel('Payee').fill('Bhat-Bhateni');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await page.goto('/transactions');
    const row = page.getByRole('button', { name: /Bhat-Bhateni/ });
    await expect(row).toContainText('-Rs. 1,450.00');
    await row.click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByRole('heading', { name: 'Edit transaction' })).toBeVisible();
    await editor.getByLabel('Amount').fill('1500');
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /Bhat-Bhateni/ })).toContainText('-Rs. 1,500.00');

    await page.getByRole('button', { name: /Bhat-Bhateni/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete this transaction?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText('Moved to trash')).toBeVisible();
    await expect(page.getByText('No transactions yet')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: /Bhat-Bhateni/ })).toBeVisible();
  });

  test('amount fields take numbers only, and say what is wrong', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    const amount = dialog.getByLabel('Amount');
    // Letters never appear; sums and pasted amounts still work.
    await amount.pressSequentially('abc12x3');
    await expect(amount).toHaveValue('12×3');
    await expect(dialog.getByText('= 36.00')).toBeVisible();
    await amount.fill('Rs. 1,500');
    await expect(amount).toHaveValue('1,500');
    // A sum that doesn't add up is explained under the field.
    await amount.fill('12+');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByText('Enter a valid amount, like 1,500 or 120+45')).toBeVisible();
    await expect(amount).toBeFocused();
    await amount.pressSequentially('8');
    await expect(dialog.getByText('Enter a valid amount, like 1,500 or 120+45')).toBeHidden();
    await dialog.getByLabel('Payee').fill('Bus');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();
    await expect(page.getByText('Rs. 20').first()).toBeVisible();
  });

  test('choose a profile picture, or use a photo', async ({ signedIn: page }) => {
    await page.goto('/settings?tab=profile');
    await page.getByRole('button', { name: 'Change picture' }).click();
    await page.getByRole('button', { name: 'Mountain' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Picture updated')).toBeVisible();
    expect((await (await page.request.get('/api/v1/me')).json()).user.avatar).toBe(
      'preset:mountain',
    );

    await page.getByRole('button', { name: 'Change picture' }).click();
    await page.getByRole('tab', { name: 'Photo' }).click();
    await page
      .getByRole('dialog')
      .locator('input[type=file]')
      .setInputFiles({
        name: 'me.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
    await expect(page.getByRole('dialog').getByRole('img', { name: 'Preview' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const avatar = (await (await page.request.get('/api/v1/me')).json()).user.avatar as string;
    expect(avatar).toMatch(/^\/api\/v1\/avatars\//);
    expect((await page.request.get(avatar)).ok()).toBeTruthy();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Picture removed')).toBeVisible();
  });

  test('describe a transaction in words (no AI needed)', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    const describe = dialog.getByLabel('Describe the transaction');
    await describe.fill('lunch 450 at Bhojan Griha yesterday via eSewa');
    await describe.press('Enter');
    // Enter fills the form; it doesn't save it.
    await expect(dialog.getByRole('heading', { name: 'New expense' })).toBeVisible();
    await expect(dialog.getByLabel('Amount')).toHaveValue(/^450/);
    await expect(dialog.getByLabel('Payee')).toHaveValue('Bhojan Griha');
    await expect(dialog.getByLabel('Account')).toHaveText(/eSewa/);
    await expect(describe).toHaveValue('');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await page.goto('/transactions');
    const row = page.getByRole('button', { name: /Bhojan Griha/ });
    await expect(row).toContainText('Dining Out');
    await expect(row).toContainText('-Rs. 450.00');
    await expect(page.getByText('Yesterday')).toBeVisible();

    // Without an API key on the server, the AI helpers say so.
    await page.goto('/settings');
    await expect(page.getByText(/Not set up on this server/)).toBeVisible();
  });

  test('transfer between accounts updates both balances', async ({ signedIn: page }) => {
    await page.keyboard.press('t');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount sent').fill('20000');
    await choose(dialog.getByLabel('From'), 'Nabil Bank');
    await choose(dialog.getByLabel('To'), 'eSewa');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Transfer saved')).toBeVisible();

    await page.goto('/accounts');
    await expect(page.getByRole('link', { name: /Nabil Bank/ })).toContainText('Rs. 30,000');
    await expect(page.getByRole('link', { name: /eSewa/ })).toContainText('Rs. 20,000');
  });

  test('set a budget and see what is left to spend', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('2000');
    await dialog.getByRole('button', { name: 'Food & Groceries' }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await page.goto('/budgets');
    const budget = page.getByLabel('Budget for Food & Groceries');
    await budget.fill('10000');
    await budget.press('Enter');
    await expect(page.getByText('Rs. 8,000 left')).toBeVisible();

    await page.goto('/');
    await expect(page.getByText('Left to spend')).toBeVisible();
    await expect(page.getByText('Rs. 8,000').first()).toBeVisible();
  });

  test('envelope budgeting: give every rupee a job', async ({ signedIn: page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Envelope' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();

    // The Rs. 60,000 in the accounts is waiting for a job.
    await page.goto('/budgets');
    const ready = page.getByText('Ready to assign', { exact: true }).locator('..');
    await expect(ready).toContainText('Rs. 60,000');
    const budget = page.getByLabel('Budget for Food & Groceries');
    await budget.fill('10000');
    await budget.press('Enter');
    await expect(ready).toContainText('Rs. 50,000');

    // Overspend, then cover it from Ready to assign.
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('12000');
    await dialog.getByRole('button', { name: 'Food & Groceries' }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();
    await expect(page.getByText('Rs. 2,000 over', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cover Rs. 2,000 from Ready to assign' }).click();
    await expect(ready).toContainText('Rs. 48,000');
    await expect(page.getByText('Rs. 0 left')).toBeVisible();

    // Move some to Transport.
    await page.getByRole('button', { name: 'Move money', exact: true }).click();
    const move = page.getByRole('dialog', { name: 'Move money' });
    await move.getByLabel('Amount').fill('5000');
    const to = move.getByLabel('To');
    await choose(to, /^Transport/);
    await move.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(page.getByText('Money moved')).toBeVisible();
    await expect(ready).toContainText('Rs. 43,000');

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Rs. 43,000 ready to assign' })).toBeVisible();
  });

  test('insights: track a subscription found in history, and see the balance ahead', async ({
    signedIn: page,
    user,
    baseURL,
  }) => {
    const base = `/api/v1/workspaces/${user.workspaceId}`;
    const headers = { origin: baseURL! };
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const accounts: Array<{ id: string; name: string }> = await (
      await page.request.get(`${base}/accounts`)
    ).json();
    for (const a of accounts) {
      await page.request.patch(`${base}/accounts/${a.id}`, {
        data: { openingDate: daysAgo(200) },
        headers,
      });
    }
    const cash = accounts.find((a) => a.name === 'Cash')!.id;
    for (const n of [91, 61, 31, 1]) {
      const res = await page.request.post(`${base}/transactions`, {
        data: { accountId: cash, date: daysAgo(n), amountMinor: -149_900, payee: 'Netflix' },
        headers,
      });
      expect(res.ok()).toBeTruthy();
    }

    await page.goto('/insights');
    // Rs. 60,000 opening balances less four months of Netflix.
    await expect(page.getByText('Cash flow ahead')).toBeVisible();
    await expect(page.getByText('Rs. 54,004').first()).toBeVisible();
    await expect(page.getByText('Netflix looks monthly')).toBeVisible();
    await page.getByRole('button', { name: 'Track it' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name')).toHaveValue('Netflix');
    await dialog.getByRole('button', { name: 'Set up', exact: true }).click();
    await expect(page.getByText('“Netflix” set up')).toBeVisible();
    await expect(page.getByText('Netflix looks monthly')).toBeHidden();
    // Now scheduled, it shows up in the forecast.
    await page.getByText(/Scheduled in the next 30 days/).click();
    await expect(
      page.locator('details').getByRole('listitem').filter({ hasText: 'Netflix' }),
    ).toContainText('-Rs. 1,499');
  });

  test('import a bank statement CSV, then undo it', async ({ signedIn: page }) => {
    await page.goto('/import');
    await choose(page.getByLabel('Import into account'), 'Nabil Bank (NPR)');
    const csv = [
      'Txn Date,Description,Withdrawal,Deposit,Balance,Ref No',
      '2083-06-01,POS/BHAT BHATENI SUPERMARKET/KTM,"2,450.00",,"47,550.00",R1',
      '2083-06-02,Salary for Bhadra,,"85,000.00","1,32,550.00",R2',
      '2083-06-03,FONEPAY/QR/Himalayan Java,540.00,,"1,32,010.00",R3',
    ].join('\n');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'nabil.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

    // Columns and the Bikram Sambat date format are detected automatically.
    await expect(page.getByLabel('Date format')).toContainText('Bikram Sambat Year-Month-Day');
    await expect(page.getByText('3 readable')).toBeVisible();
    await page.getByRole('button', { name: /Review 3 rows/ }).click();
    await expect(page.getByText('3 of 3 will be imported into Nabil Bank')).toBeVisible();
    await page.getByRole('button', { name: 'Import 3 transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 3 transactions' })).toBeVisible();

    await page.getByRole('link', { name: 'Review them' }).click();
    await expect(page.getByRole('button', { name: /Himalayan Java/ })).toBeVisible();
    await expect(page.getByText('3 transactions')).toBeVisible();

    await page.goto('/import');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page
      .getByRole('dialog', { name: 'Undo this import?' })
      .getByRole('button', { name: 'Undo import' })
      .click();
    await expect(page.getByText('Undone', { exact: true })).toBeVisible();
  });

  test('move over from Splitwise: your share of each expense, categories kept', async ({
    signedIn: page,
  }) => {
    await page.goto('/import');
    await choose(page.getByLabel('Import into account'), 'Cash (NPR)');
    const csv = [
      'Date,Description,Category,Cost,Currency,Asha Test,Bikash',
      '2026-09-01,Dinner by the lake,Dining out,3000.00,NPR,1500.00,-1500.00',
      '2026-09-02,Taxi,Transport,1200.00,NPR,-600.00,600.00',
      '2026-09-03,Settle up,Payment,900.00,NPR,-900.00,900.00',
      ',Total balance,,,NPR,0.00,0.00',
    ].join('\n');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'splitwise.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('Looks like a Splitwise export')).toBeVisible();
    // The signed-in person (Asha Test) is picked out already.
    await expect(page.getByLabel('Which one is you?')).toHaveText('Asha Test');
    await expect(page.getByText('2 transactions to check')).toBeVisible();
    await expect(page.getByText(/1 left out \(Settling up/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('2 of 2 will be imported into Cash')).toBeVisible();
    await page.getByRole('button', { name: 'Import 2 transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 2 transactions' })).toBeVisible();

    await page.goto('/transactions');
    const dinner = page.getByRole('button', { name: /Dinner by the lake/ });
    await expect(dinner).toContainText('-Rs. 1,500.00');
    await expect(dinner).toContainText('Dining Out');
    await expect(page.getByRole('button', { name: /Taxi/ })).toContainText('Transport');
  });

  test('review imported transactions and turn a choice into a rule', async ({ signedIn: page }) => {
    await page.goto('/import');
    await choose(page.getByLabel('Import into account'), 'Nabil Bank (NPR)');
    const csv = [
      'Date,Description,Amount',
      '2026-10-02,POS/DARAZ ONLINE PVT LTD,-2899',
      '2026-10-01,FONEPAY/QR/PATHAO RIDE,-320',
    ].join('\n');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: /Review 2 rows/ }).click();
    await page.getByRole('button', { name: 'Import 2 transactions' }).click();
    await page.getByRole('link', { name: 'Open review inbox' }).click();

    await expect(page.getByRole('button', { name: /To review · 2/ })).toBeVisible();
    // Newest first: the Daraz purchase.
    await page.getByRole('button', { name: 'Choose category' }).first().click();
    await page.keyboard.type('Shopping');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Categorized as Shopping')).toBeVisible();
    await page.getByRole('button', { name: 'Always do this' }).click();

    const dialog = page.getByRole('dialog', { name: 'New rule' });
    await expect(dialog.getByLabel('Condition 1 text')).toHaveValue('daraz');
    await dialog.getByRole('button', { name: 'Create rule' }).click();
    await expect(page.getByText('Rule created')).toBeVisible();
    await expect(page.getByRole('button', { name: /To review · 1/ })).toBeVisible();

    await page.goto('/settings?tab=rules');
    await expect(page.getByText('Category: Shopping')).toBeVisible();
    await page.getByRole('switch', { name: /enabled/ }).click();
    await expect(page.getByRole('switch', { name: /enabled/ })).not.toBeChecked();
  });

  test('set up a monthly bill and record it when due', async ({ signedIn: page }) => {
    await page.goto('/recurring');
    await page.getByRole('button', { name: 'New recurring' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New recurring' });
    await dialog.getByLabel('Amount', { exact: true }).fill('1,500');
    await dialog.getByLabel('Payee').fill('WorldLink');
    await dialog.getByRole('button', { name: 'Choose category' }).click();
    await page.keyboard.type('Utilities');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Monthly on the')).toBeVisible();
    await dialog.getByRole('button', { name: 'Set up' }).click();
    await expect(page.getByText('“WorldLink” set up')).toBeVisible();

    // Due today, so it waits under "Due now" until recorded, and can be recorded from Home too.
    await expect(page.getByText('Due now')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
    await page.keyboard.press('n');
    await page.getByRole('dialog').getByLabel('Amount').fill('200');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();
    await page.goto('/');
    await page.getByRole('button', { name: 'Record WorldLink' }).click();
    await expect(page.getByText('WorldLink recorded')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record WorldLink' })).toBeHidden();
    await page.goto('/recurring');
    await expect(page.getByText('Due now')).toBeHidden();

    await page.goto('/transactions');
    await expect(page.getByRole('button', { name: /WorldLink/ })).toContainText('-Rs. 1,500.00');
  });

  test('a monthly limit and a savings goal', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    await page.getByRole('dialog').getByLabel('Amount').fill('2000');
    await page.getByRole('dialog').getByRole('button', { name: 'Shopping' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Set an overall monthly spending limit' }).click();
    await page.getByLabel('Spend at most this much a month').fill('50000');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Monthly limit set')).toBeVisible();
    await expect(page.getByText('Rs. 48,000 left')).toBeVisible();
    await page.goto('/');
    await expect(page.getByText('Limit Rs. 50,000')).toBeVisible();
    await expect(page.getByText('Rs. 48,000', { exact: true })).toBeVisible();

    await page.goto('/budgets?view=goals');
    await page.getByRole('button', { name: 'New goal' }).click();
    const dialog = page.getByRole('dialog', { name: 'New goal' });
    await dialog.getByLabel('Name').fill('New phone');
    await dialog.getByLabel('Target amount').fill('60,000');
    await dialog.getByLabel('Reach it by a date').click(); // no date
    await dialog.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByText('Goal created')).toBeVisible();
    await page.getByRole('button', { name: 'Add money' }).click();
    await page.getByRole('dialog').getByLabel('Amount').fill('15000');
    await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('25% there')).toBeVisible();
  });

  test('a budget running low shows up under the bell', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    await page.getByRole('dialog').getByLabel('Amount').fill('9500');
    await page.getByRole('dialog').getByRole('button', { name: 'Food & Groceries' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();
    await page.goto('/budgets');
    const budget = page.getByLabel('Budget for Food & Groceries');
    await budget.fill('10000');
    await budget.press('Enter');
    await expect(page.getByText('Rs. 500 left')).toBeVisible();

    const bell = page.getByRole('button', { name: 'Notifications, 1 unread' });
    await expect(bell).toBeVisible();
    await bell.click();
    await page.getByRole('button', { name: /Food & Groceries budget is almost used/ }).click();
    await expect(page).toHaveURL(/\/budgets$/);
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

    await page.goto('/settings?tab=notifications');
    const toggle = page.getByRole('switch', { name: /Budgets running low/ });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.reload();
    await expect(page.getByRole('switch', { name: /Budgets running low/ })).not.toBeChecked();
  });

  test('attach a receipt, mark pending, then reconcile the account', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('1,000');
    await choose(dialog.getByLabel('Account'), 'Nabil Bank');
    await dialog.getByLabel('Payee').fill('Daraz');
    // A 1×1 PNG, queued until the expense is saved.
    await page.locator('input[type=file]').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await dialog.getByText('Pending').click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await page.goto('/transactions');
    const row = page.getByRole('button', { name: /Daraz/ });
    await expect(row).toContainText('Pending');
    await expect(row.getByLabel('1 attachment')).toBeVisible();

    await page.goto('/accounts');
    await page.getByRole('link', { name: /Nabil Bank/ }).click();
    await expect(page.getByText('1 pending')).toBeVisible();
    await page.getByRole('button', { name: 'Reconcile' }).click();
    // The statement shows the opening balance; the pending purchase isn't on it yet.
    await page.getByLabel('Closing balance on the statement').fill('50,000');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('0 of 1 ticked')).toBeVisible();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByText(/Nabil Bank reconciled through/)).toBeVisible();
    await expect(page.getByText(/Reconciled through/).first()).toBeVisible();
  });

  test('import an OFX statement and pasted SMS alerts', async ({ signedIn: page }) => {
    await page.goto('/import');
    await choose(page.getByLabel('Import into account'), 'Nabil Bank (NPR)');
    const ofx = [
      'OFXHEADER:100',
      '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>NPR',
      '<BANKTRANLIST>',
      '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260915<TRNAMT>-2450.00<FITID>F1<NAME>BHAT BHATENI</STMTTRN>',
      '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260916<TRNAMT>85000<FITID>F2<NAME>SALARY</STMTTRN>',
      '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
    ].join('\n');
    await page.locator('input[type=file]').setInputFiles({
      name: 'nabil.ofx',
      mimeType: 'application/x-ofx',
      buffer: Buffer.from(ofx),
    });
    // No column matching for OFX: straight to review.
    await expect(page.getByText('2 of 2 will be imported into Nabil Bank')).toBeVisible();
    await page.getByRole('button', { name: 'Import 2 transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 2 transactions' })).toBeVisible();

    await page.getByRole('button', { name: 'Import another file' }).click();
    await page.getByRole('button', { name: 'Paste SMS alerts' }).click();
    await page
      .getByLabel('Alert messages')
      .fill(
        'Dear Customer, your A/C 01XXXX456 has been debited by NPR 1,200.00 on 20/09/2026. Remarks: FONEPAY/QR/HIMALAYAN JAVA. Bal: NPR 10,000.00\n\nHello, not an alert',
      );
    await page.getByRole('button', { name: 'Read messages' }).click();
    await expect(page.getByText('1 of 1 will be imported into Nabil Bank')).toBeVisible();
    await expect(page.getByText(/didn’t look like a transaction/)).toBeVisible();
    await page.getByRole('button', { name: 'Import 1 transaction' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 1 transaction' })).toBeVisible();
  });

  test('add an expense offline; it syncs when back online', async ({ signedIn: page }) => {
    await page.context().setOffline(true);
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('340');
    await dialog.getByLabel('Payee').fill('Tea stall');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
    await expect(page.getByText(/1 transaction saved on this device/)).toBeVisible();

    await page.context().setOffline(false);
    await expect(page.getByText('Synced 1 transaction recorded offline')).toBeVisible();
    await page.goto('/transactions');
    await expect(page.getByRole('button', { name: /Tea stall/ })).toContainText('-Rs. 340.00');
  });

  test('a monthly report that prints to PDF', async ({ signedIn: page }) => {
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('2500');
    await dialog.getByRole('button', { name: 'Dining Out' }).click();
    await dialog.getByLabel('Payee').fill('Bhojan Griha');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await page.goto('/reports');
    await page.getByRole('link', { name: 'Monthly report' }).click();
    await expect(page.getByText('Monthly report · Home')).toBeVisible();
    await expect(page.getByText('Where the money went')).toBeVisible();
    await expect(page.getByRole('row', { name: /^Dining Out/ })).toContainText('Rs. 2,500');
    await expect(page.getByRole('row', { name: /Bhojan Griha/ })).toBeVisible();

    // On paper: no app chrome, only the report.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeHidden();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeHidden();
    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(10_000);
  });

  test('switch the app to Nepali', async ({ signedIn: page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'नेपाली' }).click();
    await expect(page.getByRole('heading', { name: 'सेटिङ' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ne');

    // Quick add understands Nepali too, and amounts come back in Devanagari digits.
    await page.goto('/');
    await expect(page.getByText('पहिलो खर्च लेखौँ')).toBeVisible();
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog', { name: 'नयाँ खर्च' });
    const describe = dialog.getByLabel('कारोबार लेख्नुहोस्');
    await describe.fill('खाना ४५० हिजो');
    await describe.press('Enter');
    await expect(dialog.getByLabel('रकम')).toHaveValue(/^450/);
    await expect(dialog.getByRole('button', { name: 'Dining Out', pressed: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'सुरक्षित गर्नुहोस्', exact: true }).click();
    await expect(page.getByText('खर्च थपियो')).toBeVisible();
    await expect(page.getByText('यो महिनाको खर्च')).toBeVisible();
    await expect(page.getByText('रु. ४५०').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'कारोबार', exact: true })).toBeVisible();

    await page.goto('/settings');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('make an access token and use it from a script', async ({
    signedIn: page,
    playwright,
    baseURL,
  }) => {
    await page.goto('/settings?tab=integrations');
    await page.getByRole('button', { name: 'New token' }).click();
    await page.getByLabel('Name').fill('Spreadsheet');
    await choose(page.getByLabel('Access'), 'Read and write');
    await page.getByRole('button', { name: 'Make token' }).click();
    const token = await page.getByLabel('New access token').inputValue();
    expect(token).toMatch(/^et_/);

    // A script: no cookies, just the token.
    const script = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    });
    const me = await (await script.get('/api/v1/me')).json();
    const base = `/api/v1/workspaces/${me.defaultWorkspaceId}`;
    const accounts = await (await script.get(`${base}/accounts`)).json();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
    const created = await script.post(`${base}/transactions`, {
      data: {
        accountId: accounts[0].id,
        date: today,
        amountMinor: -12_300,
        payee: 'From a script',
      },
    });
    expect(created.status()).toBe(201);
    await page.goto('/transactions');
    await expect(page.getByText('From a script')).toBeVisible();

    await page.goto('/settings?tab=integrations');
    await expect(page.getByText('Read and write · used today')).toBeVisible();
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('No tokens yet.')).toBeVisible();
    expect((await script.get('/api/v1/me')).status()).toBe(401);
    await script.dispose();
  });

  test('send new transactions to a webhook', async ({ signedIn: page }) => {
    const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await page.goto('/settings?tab=integrations');
      await page.getByRole('button', { name: 'Add webhook' }).click();
      await page.getByLabel('Address', { exact: true }).fill(`http://127.0.0.1:${port}/hook`);
      await page.getByLabel('Description').fill('Spreadsheet');
      await page.getByRole('button', { name: 'Add webhook' }).last().click();
      const secret = await page.getByLabel('Signing secret').inputValue();
      expect(secret).toMatch(/^whsec_/);

      await page.keyboard.press('n');
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Amount').fill('320');
      await dialog.getByRole('button', { name: 'Dining Out' }).click();
      await dialog.getByLabel('Payee').fill('Tea stall');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();

      await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);
      const [delivery] = received;
      const event = JSON.parse(delivery!.body);
      expect(event).toMatchObject({
        type: 'transaction.created',
        data: { transaction: { payeeName: 'Tea stall', amountMinor: -32_000 } },
      });
      // Signed with the secret shown once in the app.
      const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
      const signed = `${delivery!.headers['webhook-id']}.${delivery!.headers['webhook-timestamp']}.${delivery!.body}`;
      expect(delivery!.headers['webhook-signature']).toBe(
        `v1,${createHmac('sha256', key).update(signed).digest('base64')}`,
      );

      await page.getByRole('button', { name: 'Log' }).click();
      await expect(page.getByText('transaction.created')).toBeVisible();
      await expect(page.getByText('Delivered', { exact: true })).toBeVisible();
    } finally {
      server.close();
    }
  });

  test('email a receipt in and find it waiting for review', async ({
    signedIn: page,
    user,
    request,
  }) => {
    await page.goto('/settings?tab=integrations');
    const address = await page.getByLabel('Email-in address').inputValue();
    expect(address).toMatch(/^money\+et[a-z2-7]{14}@example\.com$/);

    const raw = [
      `From: Asha Test <${user.email}>`,
      `To: ${address}`,
      'Subject: Fwd: tea 120 cash at Chiya Pasal',
      `Message-ID: <e2e-${Date.now()}@example.com>`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Forwarded receipt',
    ].join('\r\n');
    const res = await request.post('/api/inbound/email', {
      headers: {
        authorization: 'Bearer e2e-email-in-secret-0123456789',
        'content-type': 'message/rfc822',
      },
      data: raw,
    });
    expect(res.status()).toBe(202);

    await page.goto('/inbox');
    await expect(page.getByText('Chiya Pasal')).toBeVisible();
    await page.goto('/settings?tab=integrations');
    const log = page.getByRole('list', { name: 'Recent emails' });
    await expect(log.getByText('Fwd: tea 120 cash at Chiya Pasal')).toBeVisible();
    await expect(log.getByText('Added')).toBeVisible();
  });

  test('in the Android app, read bank alerts from the phone', async ({ signedIn: page }) => {
    // Stand in for the native shell: its bridge, and an inbox with two alerts and a chat.
    await page.addInitScript(() => {
      const now = Date.now();
      const w = window as unknown as Record<string, unknown>;
      w.androidBridge = { postMessage() {} };
      w.Capacitor = {
        PluginHeaders: [{ name: 'SmsInbox', methods: [{ name: 'read', rtype: 'promise' }] }],
        nativePromise: async () => ({
          messages: [
            {
              id: '2',
              sender: 'NABIL_ALERT',
              date: now - 3_600_000,
              body: 'Dear Customer, your A/C 01XXXX456 has been debited by NPR 1,250.00. Remarks: POS/BHAT BHATENI. Ref: 445566. Bal: NPR 45,000.00',
            },
            { id: '1', sender: '9841000000', date: now - 7_200_000, body: 'See you at 5?' },
          ],
        }),
      };
    });
    await page.goto('/import');
    await choose(page.getByLabel('Import into account'), 'Nabil Bank (NPR)');
    await page.getByText('SMS alerts', { exact: true }).click();
    await page.getByRole('button', { name: 'Read alerts from this phone' }).click();
    await expect(page.getByText('Found 1 alert.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Alert messages')).toHaveValue(/BHAT BHATENI/);
    await expect(page.getByLabel('Alert messages')).not.toHaveValue(/See you/);
    await page.getByRole('button', { name: 'Read messages' }).click();
    await page.getByRole('button', { name: /^Import 1 transaction/ }).click();
    await expect(page.getByRole('heading', { name: 'Imported 1 transaction' })).toBeVisible();
  });

  test('share a receipt to the installed app', async ({ signedIn: page }) => {
    await page.goto('/');
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.ready).active?.state === 'activated',
    );
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    // What Android does when a photo is shared to the app: a form POST the service worker takes.
    const status = await page.evaluate(async () => {
      const png = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        ),
        (c) => c.charCodeAt(0),
      );
      const form = new FormData();
      form.append('receipt', new File([png], 'bill.png', { type: 'image/png' }));
      form.append('text', 'Dinner at Thakali Kitchen');
      const res = await fetch('/share-target', { method: 'POST', body: form, redirect: 'manual' });
      return res.type;
    });
    expect(status).toBe('opaqueredirect');
    await page.goto('/?shared=1');
    const dialog = page.getByRole('dialog', { name: 'New expense' });
    await expect(dialog.getByRole('button', { name: 'Remove bill.png' })).toBeVisible();
    await expect(dialog.getByLabel('Notes')).toHaveValue('Dinner at Thakali Kitchen');
    await expect(page).toHaveURL(/\/$/);
  });

  test('track shares in an investment account', async ({ signedIn: page }) => {
    await page.goto('/accounts');
    await page.getByRole('button', { name: 'Add account' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Name').fill('Meroshare');
    await choose(form.getByLabel('Type'), 'Investment');
    await form.getByRole('button', { name: /^(Add|Create|Save)/ }).click();
    await page.getByRole('link', { name: /Meroshare/ }).click();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a holding' });
    await dialog.getByLabel('Symbol').fill('nabil');
    await dialog.getByLabel('Quantity').fill('50');
    await dialog.getByLabel('Total cost').fill('24500');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('No price')).toBeVisible();

    await page.getByRole('button', { name: 'Update prices' }).click();
    await page.getByLabel('Paste prices').fill('NABIL\t512.30\nNICA 745');
    await expect(page.getByLabel('Price of NABIL')).toHaveValue('512.30');
    await page.getByRole('button', { name: 'Save prices' }).click();
    const row = page.getByRole('row', { name: /^NABIL/ });
    await expect(row.getByRole('cell', { name: 'Rs. 25,615' })).toBeVisible();
    await expect(row.getByText('+Rs. 1,115')).toBeVisible();

    await page.goto('/accounts');
    await expect(page.getByText('Rs. 25,615 invested')).toBeVisible();
  });

  test('reports and settings pages load', async ({ signedIn: page }) => {
    await page.goto('/reports?tab=cashflow');
    await expect(page.getByText('Income and spending per month')).toBeVisible();
    await page.getByRole('tab', { name: 'Net worth' }).click();
    await expect(page.getByText('Net worth at the end of each month')).toBeVisible();
    await page.getByRole('tab', { name: 'Calendar' }).click();
    await expect(page.getByText('Spending by day')).toBeVisible();
    await page.getByRole('tab', { name: 'Compare' }).click();
    await expect(page.getByText('Spending now')).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByLabel('Main currency')).toContainText('NPR');
    await page.getByRole('tab', { name: 'Categories' }).click();
    await expect(page.getByText('Remittance')).toBeVisible();
  });

  test('workspace settings wait for Save, and leaving with changes asks first', async ({
    signedIn: page,
  }) => {
    await page.goto('/settings');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    await page.getByLabel('Name', { exact: true }).fill('Home budget');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('tab', { name: 'Members' }).click();
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Home budget');
    await save.click();
    await expect(page.getByText('Settings saved')).toBeVisible();
    await expect(save).toBeDisabled();
    // Saved, so moving on doesn't ask.
    await page.getByRole('tab', { name: 'Members' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveTitle(/^Members · Settings · Home budget/);
  });

  test('first run: empty pages point the way', async ({ signedIn: page }) => {
    await page.goto('/transactions');
    await expect(page.getByText('No transactions yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Import statement' })).toBeVisible();
    // Nothing to search, filter or export yet.
    await expect(page.getByLabel('Search transactions')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Export CSV' })).toBeHidden();

    await page.goto('/reports');
    await expect(page.getByText('No reports yet')).toBeVisible();

    // Budgets: actions that can't work yet say why; "Set budgets" starts at the first amount.
    await page.goto('/budgets');
    const copy = page.getByRole('button', { name: 'Copy last month' });
    await expect(copy).toHaveAttribute('aria-disabled', 'true');
    await copy.click({ force: true });
    await expect(
      page.locator('[data-sonner-toast]').getByText('Last month has no budgets to copy'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Set budgets' }).click();
    await expect(page.getByLabel('Budget for Food & Groceries')).toBeFocused();
    await page.keyboard.type('15000');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Rs. 15,000').first()).toBeVisible();
    await expect(page.getByText('No budgets yet')).toBeHidden();

    // The first transaction: the new row is highlighted for a moment as it appears.
    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Add transaction' }).click();
    await page.getByRole('dialog').getByLabel('Amount').fill('120');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();
    await expect(page.locator('main .animate-fresh')).toHaveCount(1);
  });

  test('select transactions and change them together', async ({
    signedIn: page,
    user,
    baseURL,
  }) => {
    await addExpenses(page, user.workspaceId, baseURL!, ['Bhatbhateni', 'Daraz', 'Pathao']);
    await page.goto('/transactions');
    await page.getByRole('checkbox', { name: 'Select Bhatbhateni' }).click();
    await page.getByRole('checkbox', { name: 'Select Daraz' }).click();
    const bar = page.getByRole('region', { name: 'Selected transactions' });
    await expect(bar).toContainText('2 selected');
    // Everything is loaded, so "all" is all of them; Escape clears.
    await bar.getByRole('button', { name: 'Select all 3' }).click();
    await expect(bar).toContainText('3 selected');
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    await expect(page.locator('[role=checkbox][data-state=checked]')).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Select Daraz' }).click();
    await page.getByRole('checkbox', { name: 'Select Pathao' }).click();
    await bar.getByRole('button', { name: 'Categorize…' }).click();
    await page.keyboard.type('Shopping');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Categorized 2 as Shopping')).toBeVisible();
    await expect(bar).toBeHidden();
    await expect(page.getByRole('button', { name: /^Daraz/ })).toContainText('Shopping');
  });

  test('on phones, select with a long press or "Select" @mobile', async ({
    signedIn: page,
    user,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'touch screens only; with a mouse the checkboxes are always shown');
    await addExpenses(page, user.workspaceId, baseURL!, ['Bhatbhateni', 'Daraz']);
    await page.goto('/transactions');
    const row = (name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
    await expect(row('Daraz')).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    // A long press selects the row instead of opening it.
    const box = (await row('Daraz').boundingBox())!;
    const point = { x: box.x + 40, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const bar = page.getByRole('region', { name: 'Selected transactions' });
    await expect(bar).toContainText('1 selected');
    await expect(page.getByRole('dialog')).toBeHidden();

    // While selecting, a tap selects too.
    await row('Bhatbhateni').tap();
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Clear selection' }).tap();
    await expect(bar).toBeHidden();

    // "Select" starts the same mode; "Cancel" ends it, and a tap opens the transaction again.
    await page.getByRole('button', { name: 'Select', exact: true }).tap();
    await expect(bar).toContainText('Tap transactions to select');
    await row('Daraz').tap();
    await expect(bar).toContainText('1 selected');
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await row('Daraz').tap();
    await expect(page.getByRole('dialog', { name: 'Edit transaction' })).toBeVisible();
  });

  test('keyboard: skip link, page titles and focus after navigating', async ({
    signedIn: page,
  }) => {
    await page.goto('/transactions');
    await expect(page).toHaveTitle(/^Transactions · .+ · Expense Tracker$/);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeFocused();

    // A new page puts focus on its heading, so screen readers announce where you are.
    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await expect(page).toHaveTitle(/^Accounts · /);
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeFocused();
  });
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('dropdowns use the theme; past payees are suggested as you type', async ({
    signedIn: page,
  }) => {
    await page.keyboard.press('n');
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('120');
    await dialog.getByLabel('Payee').fill('Himalayan Java');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await page.keyboard.press('n');
    dialog = page.getByRole('dialog');
    const payee = dialog.getByLabel('Payee');
    await payee.fill('java');
    await expect(page.getByRole('option', { name: 'Himalayan Java' })).toBeVisible();
    await payee.press('ArrowDown');
    await payee.press('Enter');
    await expect(payee).toHaveValue('Himalayan Java');
    await expect(page.getByRole('listbox')).toBeHidden();

    // The list is drawn by the app on the popover colour, not by the system in its own.
    await dialog.getByLabel('Account').click();
    const colors = await page.getByRole('listbox').evaluate((list) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--popover)';
      document.body.append(probe);
      const popover = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        dark: document.documentElement.classList.contains('dark'),
        list: getComputedStyle(list).backgroundColor,
        popover,
      };
    });
    expect(colors.dark).toBe(true);
    expect(colors.list).toBe(colors.popover);
    await page.getByRole('option', { name: 'eSewa', exact: true }).click();
    await expect(dialog.getByLabel('Account')).toHaveText('eSewa');
  });
});
