import type { Me, Workspace } from '@et/shared';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { storage } from './utils';

interface SessionValue {
  me: Me;
  workspace: Workspace;
  switchWorkspace: (id: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const WORKSPACE_KEY = 'et.workspace';

/** Picks the workspace to show: last used on this device, else the account default, else the first. */
export function pickWorkspace(me: Me): Workspace | null {
  const saved = storage.get(WORKSPACE_KEY);
  return (
    me.workspaces.find((w) => w.id === saved) ??
    me.workspaces.find((w) => w.id === me.defaultWorkspaceId) ??
    me.workspaces[0] ??
    null
  );
}

export function rememberWorkspace(id: string) {
  storage.set(WORKSPACE_KEY, id);
}

export function SessionProvider({
  me,
  workspace,
  onSwitch,
  children,
}: {
  me: Me;
  workspace: Workspace;
  onSwitch: (id: string) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ me, workspace, switchWorkspace: onSwitch }),
    [me, workspace, onSwitch],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** The session if someone is signed in (sign-in pages have none). */
export function useOptionalSession(): SessionValue | null {
  return useContext(SessionContext);
}

export function useWorkspace(): Workspace {
  return useSession().workspace;
}

export function useCanWrite(): boolean {
  return useWorkspace().role !== 'viewer';
}
