import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';

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
