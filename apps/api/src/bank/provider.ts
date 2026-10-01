import type { BankProviderId, BankProviderInfo } from '@et/shared';

/**
 * Bank sync providers sit behind this interface, so others can be added (or faked in tests)
 * without touching the rest. A provider turns what the person pasted into a credential we keep
 * (sealed), and reads accounts and their transactions with it. It never moves money.
 */

export interface ProviderTransaction {
  /** The provider's id for it: kept as the transaction's reference, so it's only added once. */
  id: string;
  /** When it posted, as a timestamp (seconds). */
  postedAt: number;
  /** Decimal string in the account currency, negative = money out ("-12.34"). */
  amount: string;
  description: string;
  payee: string | null;
}

export interface ProviderAccount {
  id: string;
  name: string;
  institution: string;
  /** ISO code (or the provider's custom currency URL, which we can't use). */
  currency: string;
  /** Decimal string, if reported. */
  balance: string | null;
  /** Seconds. */
  balanceAt: number | null;
  transactions: ProviderTransaction[];
}

export class BankProviderError extends Error {
  constructor(
    message: string,
    /** The credential no longer works: the person has to connect again. */
    readonly reconnect = false,
  ) {
    super(message);
    this.name = 'BankProviderError';
  }
}

export interface BankProvider {
  readonly info: BankProviderInfo & { id: BankProviderId };
  /** Exchanges a setup token for a credential to keep. */
  connect(setupToken: string): Promise<{ credential: string }>;
  /** Accounts, with transactions posted since `since` (seconds). */
  fetchAccounts(
    credential: string,
    since: number,
  ): Promise<{ accounts: ProviderAccount[]; errors: string[] }>;
}
