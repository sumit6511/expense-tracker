import { createUser, expect, test } from './fixtures';

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
    await expect(page.getByLabel('Main currency')).toHaveValue('NPR');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Cash balance').fill('5,000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Festivals & Gifts')).toBeVisible();
    await page.getByRole('button', { name: 'Start tracking' }).click();

    await expect(page.getByText('Let’s record your first expense')).toBeVisible();
    await page.getByRole('button', { name: 'Add expense' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('250+50');
    await expect(dialog.getByText('= 300.00')).toBeVisible();
    await dialog.getByRole('button', { name: 'Dining Out' }).click();
    await dialog.getByLabel('Payee').fill('Momo Hut');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expense added')).toBeVisible();

    await expect(page.getByText('Spent this month')).toBeVisible();
    await expect(page.getByText('Rs. 300').first()).toBeVisible();
  });

  test('signing in and out', async ({ page, baseURL, browser }) => {
    const user = await createUser((await browser.newContext({ baseURL })).request, baseURL!);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Let’s record your first expense')).toBeVisible();

    await page.getByRole('button', { name: 'Asha Test' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
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

  test('transfer between accounts updates both balances', async ({ signedIn: page }) => {
    await page.keyboard.press('t');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount sent').fill('20000');
    await dialog.getByLabel('From').selectOption({ label: 'Nabil Bank' });
    await dialog.getByLabel('To').selectOption({ label: 'eSewa' });
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

  test('import a bank statement CSV, then undo it', async ({ signedIn: page }) => {
    await page.goto('/import');
    await page.getByLabel('Import into account').selectOption({ label: 'Nabil Bank (NPR)' });
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
    await expect(page.getByLabel('Date format')).toHaveValue('bs-ymd');
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

  test('reports and settings pages load', async ({ signedIn: page }) => {
    await page.goto('/reports?tab=cashflow');
    await expect(page.getByText('Income and spending per month')).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByLabel('Main currency')).toHaveValue('NPR');
    await page.getByRole('tab', { name: 'Categories' }).click();
    await expect(page.getByText('Remittance')).toBeVisible();
  });
});
