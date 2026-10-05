import { useEffect } from 'react';
import { useOptionalSession } from './session';

/**
 * The browser tab's title for the current page: "Transactions · Personal · Expense Tracker".
 * Tabs and history become tell-apart-able, and screen readers announce the page.
 */
export function usePageTitle(title: string | null | undefined) {
  const workspace = useOptionalSession()?.workspace.name;
  useEffect(() => {
    if (!title) return;
    document.title = [title, workspace, 'Expense Tracker'].filter(Boolean).join(' · ');
  }, [title, workspace]);
}
