import { createUser, expect, test, totp } from './fixtures';

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
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Let’s record your first expense')).toBeVisible();

    await page.getByRole('button', { name: 'Asha Test' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('account security', () => {
  test('turn on two-step sign-in, then sign in with a code and a backup code', async ({
    signedIn: page,
    user,
    browser,
    baseURL,
  }) => {
    await page.goto('/settings?tab=profile');
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
    await page.goto('/settings?tab=profile');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.getByText('Passkey added')).toBeVisible();
    await expect(page.getByText(/^Chrome on /)).toBeVisible();

    await page.getByRole('button', { name: 'Asha Test' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByText('Let’s record your first expense')).toBeVisible();
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

  test('review imported transactions and turn a choice into a rule', async ({ signedIn: page }) => {
    await page.goto('/import');
    await page.getByLabel('Import into account').selectOption({ label: 'Nabil Bank (NPR)' });
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

    // Due today, so it waits under "Due now" until recorded.
    await expect(page.getByText('Due now')).toBeVisible();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByText('WorldLink recorded')).toBeVisible();
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
    await dialog.getByLabel('Account').selectOption({ label: 'Nabil Bank' });
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
    await page.getByLabel('Import into account').selectOption({ label: 'Nabil Bank (NPR)' });
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
    await page.getByRole('button', { name: 'Import 1 transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 1 transactions' })).toBeVisible();
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
    await expect(page.getByLabel('Main currency')).toHaveValue('NPR');
    await page.getByRole('tab', { name: 'Categories' }).click();
    await expect(page.getByText('Remittance')).toBeVisible();
  });
});
