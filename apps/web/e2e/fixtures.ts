import { createHmac } from 'node:crypto';
import {
  type APIRequestContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

let counter = 0;

export interface TestUser {
  email: string;
  password: string;
  workspaceId: string;
}

/** Signs up through the API (fast) and creates a workspace with a few accounts. */
export async function createUser(
  request: APIRequestContext,
  baseURL: string,
  options: { withWorkspace?: boolean } = {},
) {
  const email = `e2e-${Date.now()}-${counter++}@example.com`;
  const password = 'correct-horse-battery';
  const headers = { origin: baseURL };
  const signUp = await request.post('/api/auth/sign-up/email', {
    data: { name: 'Asha Test', email, password },
    headers,
  });
  expect(signUp.ok()).toBeTruthy();
  // Tests start where they need to; the getting-started tour has its own test.
  const toured = await request.patch('/api/v1/me', { headers, data: { tourCompleted: true } });
  expect(toured.ok()).toBeTruthy();
  let workspaceId = '';
  if (options.withWorkspace !== false) {
    const ws = await request.post('/api/v1/workspaces', {
      headers,
      data: {
        name: 'Home',
        baseCurrency: 'NPR',
        calendar: 'bs',
        accounts: [
          { name: 'Cash', type: 'cash', currency: 'NPR', openingBalanceMinor: 1_000_000 },
          { name: 'Nabil Bank', type: 'checking', currency: 'NPR', openingBalanceMinor: 5_000_000 },
          { name: 'eSewa', type: 'e_wallet', currency: 'NPR', openingBalanceMinor: 0 },
        ],
      },
    });
    expect(ws.status()).toBe(201);
    workspaceId = (await ws.json()).id;
  }
  return { email, password, workspaceId } satisfies TestUser;
}

export const test = base.extend<{ user: TestUser; signedIn: Page }>({
  user: async ({ page, baseURL }, use) => {
    // page.request shares the browser context's cookies, so the page is signed in too.
    await use(await createUser(page.request, baseURL!));
  },
  signedIn: async ({ page, user }, use) => {
    expect(user.workspaceId).toBeTruthy();
    await page.goto('/');
    await expect(page.getByText('Let’s record your first expense')).toBeVisible();
    await use(page);
  },
});

export { expect };

/** The code an authenticator app shows right now for a base32 key. */
export function totp(base32Key: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32Key.replace(/[\s=]/g, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Picks an option in one of the app's dropdowns (themed, so not native <select>s). */
export async function choose(select: Locator, option: string | RegExp) {
  await select.click();
  await select
    .page()
    .getByRole('option', { name: option, exact: typeof option === 'string' })
    .click();
  await expect(select).toHaveAttribute('aria-expanded', 'false');
}
