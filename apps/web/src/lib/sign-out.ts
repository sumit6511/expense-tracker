import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useConfirm } from '@/components/ui/dialog';
import { authApi } from './api';
import { clearOfflineData } from './offline';
import { outbox } from './outbox';

/**
 * Everything this device kept for the person is forgotten: the offline queue, cached reference
 * data and everything loaded into memory. Used whenever someone signs out or their account goes,
 * so the next person on a shared device starts clean.
 */
export async function forgetDevice(queryClient: ReturnType<typeof useQueryClient>) {
  await clearOfflineData();
  queryClient.clear();
}

/**
 * Signs out from anywhere in the app. Asks first if transactions recorded offline haven't been
 * sent yet (they'd be lost). Resolves false if the person changed their mind.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  return useCallback(
    async (after: { next?: string; email?: string } = {}) => {
      const waiting = outbox.list().length;
      if (waiting > 0) {
        const ok = await confirm({
          title: 'Sign out and discard unsynced transactions?',
          description: `${waiting} transaction${waiting === 1 ? '' : 's'} recorded offline haven’t reached the server yet and will be lost.`,
          confirmLabel: 'Sign out',
          destructive: true,
        });
        if (!ok) return false;
      }
      await authApi.signOut().catch(() => undefined);
      await forgetDevice(queryClient);
      navigate({ to: '/login', search: after });
      return true;
    },
    [confirm, navigate, queryClient],
  );
}
