import type { BudgetMode, CalendarSystem, Role } from '@et/shared';
import type { AiProvider } from './ai/provider';
import type { Auth } from './auth';
import type { Db } from './db/client';
import type { Env } from './env';
import type { WebhookSender } from './lib/webhook-http';
import type { Logger } from './logger';
import type { Mailer } from './mailer';
import type { Pusher } from './push';
import type { TokenCtx } from './services/tokens';

export interface Deps {
  db: Db;
  env: Env;
  auth: Auth;
  logger: Logger;
  /** Null when SMTP isn't configured. */
  mailer: Mailer | null;
  /** Null when Web Push is turned off. */
  pusher: Pusher | null;
  /** Null when no AI provider is set up. */
  ai: AiProvider | null;
  /** Sends webhook requests (a fake in tests). */
  webhookSender: WebhookSender;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** The workspace a request operates on, loaded by the workspace middleware. */
export interface WorkspaceCtx {
  id: string;
  name: string;
  baseCurrency: string;
  calendar: CalendarSystem;
  monthStartDay: number;
  weekStart: number;
  timezone: string;
  budgetMode: BudgetMode;
  /** First day of the budget month envelope budgeting started in. */
  envelopeSince: string | null;
  aiEnabled: boolean;
  /** The person making the request (or, for background jobs, the person it's done for). */
  userId: string;
  role: Role;
  /** Other members' private accounts: this person can't see them or their transactions. */
  hiddenAccountIds: string[];
  createdAt: Date;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    user: SessionUser | null;
    /** Set when the request was made with a personal access token instead of a session. */
    token: TokenCtx | null;
    workspace: WorkspaceCtx;
  };
};
