import { type BankProvider, BankProviderError, type ProviderAccount } from '../src/bank/provider';

/**
 * A bank for tests, registered as "simplefin": setup tokens starting with "good" connect, and
 * each credential sees the accounts the test puts in `banks`. `failing` makes reads throw.
 */
export class FakeBank implements BankProvider {
  readonly info = {
    id: 'simplefin' as const,
    label: 'Fake Bridge',
    coverage: 'Tests',
    signupUrl: 'https://example.com/create',
  };
  banks = new Map<string, ProviderAccount[]>();
  failing = new Map<string, BankProviderError>();
  reads: Array<{ credential: string; since: number }> = [];

  async connect(setupToken: string) {
    if (!setupToken.startsWith('good')) throw new BankProviderError('Bad setup token');
    const credential = `cred-${setupToken}`;
    if (!this.banks.has(credential)) this.banks.set(credential, []);
    return { credential };
  }

  async fetchAccounts(credential: string, since: number) {
    this.reads.push({ credential, since });
    const failure = this.failing.get(credential);
    if (failure) throw failure;
    const accounts = (this.banks.get(credential) ?? []).map((a) => ({
      ...a,
      transactions: a.transactions.filter((t) => t.postedAt >= since),
    }));
    return { accounts, errors: [] };
  }
}
