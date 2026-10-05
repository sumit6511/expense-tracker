import { useBlocker } from '@tanstack/react-router';
import { useConfirm } from '@/components/ui/dialog';

/**
 * Asks before leaving a form whose changes haven't been saved: moving to another page or tab
 * asks in the app, and closing or reloading the browser tab gets the browser's own warning.
 */
export function useUnsavedChanges(dirty: boolean) {
  const confirm = useConfirm();
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: async () => {
      const leave = await confirm({
        title: 'Leave without saving?',
        description: 'Your changes on this page haven’t been saved.',
        confirmLabel: 'Leave',
        destructive: true,
      });
      return !leave;
    },
  });
}
