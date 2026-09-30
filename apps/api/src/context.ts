import type { CalendarSystem, Role } from '@et/shared';
import type { Auth } from './auth';
import type { Db } from './db/client';
import type { Env } from './env';
import type { Logger } from './logger';

export interface Deps {
  db: Db;
  env: Env;
  auth: Auth;
  logger: Logger;
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
  role: Role;
  createdAt: Date;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    user: SessionUser | null;
    workspace: WorkspaceCtx;
  };
};
