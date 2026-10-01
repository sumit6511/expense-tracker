import { safeRequest } from '../lib/webhook-http';
import { type BankProvider, BankProviderError, type ProviderAccount } from './provider';

/**
 * SimpleFIN Bridge (simplefin.org): read-only access to thousands of mostly US banks for a small
 * yearly fee, paid by the person to SimpleFIN. They create a setup token there; claiming it once
 * gives an access URL (with credentials in it) that we keep sealed.
 */

interface SimplefinResponse {
  errors?: string[];
  accounts?: Array<{
    org?: { name?: string; domain?: string };
    id: string;
    name: string;
    currency: string;
    balance?: string;
    'balance-date'?: number;
    transactions?: Array<{
      id: string;
      posted: number;
      amount: string;
      description?: string;
      payee?: string;
      memo?: string;
      pending?: boolean;
    }>;
  }>;
}

export function simplefin(options: { allowPrivate?: boolean } = {}): BankProvider {
  const allowPrivate = options.allowPrivate ?? false;
  return {
    info: {
      id: 'simplefin',
      label: 'SimpleFIN Bridge',
      coverage: 'banks and cards in the United States, and some elsewhere',
      signupUrl: 'https://bridge.simplefin.org/simplefin/create',
    },

    async connect(setupToken) {
      let claimUrl: URL;
      try {
        claimUrl = new URL(Buffer.from(setupToken.trim(), 'base64').toString('utf8').trim());
      } catch {
        throw new BankProviderError('That doesn’t look like a SimpleFIN setup token');
      }
      if (claimUrl.protocol !== 'https:' && !allowPrivate) {
        throw new BankProviderError('That doesn’t look like a SimpleFIN setup token');
      }
      const res = await safeRequest(claimUrl.toString(), {
        method: 'POST',
        allowPrivate,
        maxBytes: 4096,
      });
      if (res.status === 403) {
        throw new BankProviderError(
          'This setup token was already used (or has expired). Make a new one at SimpleFIN.',
        );
      }
      if (res.status !== 200) throw new BankProviderError(`SimpleFIN answered ${res.status}`);
      const access = new URL(res.body.trim());
      if (!access.username || !access.password) {
        throw new BankProviderError('SimpleFIN didn’t give an access address');
      }
      return { credential: access.toString() };
    },

    async fetchAccounts(credential, since) {
      const access = new URL(credential);
      const auth = Buffer.from(
        `${decodeURIComponent(access.username)}:${decodeURIComponent(access.password)}`,
      ).toString('base64');
      access.username = '';
      access.password = '';
      const url = new URL(`${access.toString().replace(/\/$/, '')}/accounts`);
      url.searchParams.set('start-date', String(Math.floor(since)));
      const res = await safeRequest(url.toString(), {
        headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
        allowPrivate,
        timeoutMs: 60_000,
        maxBytes: 20 * 1024 * 1024,
      });
      if (res.status === 403 || res.status === 401) {
        throw new BankProviderError(
          'SimpleFIN no longer accepts this connection. Remove it and connect again.',
          true,
        );
      }
      if (res.status === 402) {
        throw new BankProviderError('The SimpleFIN subscription needs paying');
      }
      if (res.status !== 200) throw new BankProviderError(`SimpleFIN answered ${res.status}`);
      let data: SimplefinResponse;
      try {
        data = JSON.parse(res.body) as SimplefinResponse;
      } catch {
        throw new BankProviderError('SimpleFIN sent something unreadable');
      }
      const accounts: ProviderAccount[] = (data.accounts ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        institution: a.org?.name ?? a.org?.domain ?? '',
        currency: a.currency,
        balance: a.balance ?? null,
        balanceAt: a['balance-date'] ?? null,
        transactions: (a.transactions ?? [])
          // Pending items can change or vanish; they come back once posted.
          .filter((t) => !t.pending && t.posted > 0)
          .map((t) => ({
            id: t.id,
            postedAt: t.posted,
            amount: t.amount,
            description: [t.description, t.memo].filter(Boolean).join(' · '),
            payee: t.payee ?? null,
          })),
      }));
      return { accounts, errors: data.errors ?? [] };
    },
  };
}
