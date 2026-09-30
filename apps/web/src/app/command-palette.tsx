import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChartPie,
  House,
  Inbox,
  Keyboard,
  Landmark,
  Moon,
  Search,
  Settings,
  Sun,
  Target,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { CategoryIcon } from '@/components/icons';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTransactionDialog } from '@/features/transactions/transaction-dialog';
import { useAccounts, useCategories } from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { useTheme } from './theme';

const item =
  'flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none select-none data-[selected=true]:bg-muted [&>svg]:size-4 [&>svg]:text-muted-foreground';
const group =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground';

export function CommandPalette({
  open,
  onOpenChange,
  onHelp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHelp: () => void;
}) {
  const navigate = useNavigate();
  const { openNew } = useTransactionDialog();
  const canWrite = useCanWrite();
  const { preference, setPreference } = useTheme();
  const { data: accounts = [] } = useAccounts();
  const { data: groups = [] } = useCategories();
  const [search, setSearch] = useState('');

  const run = (fn: () => void) => {
    onOpenChange(false);
    setSearch('');
    // Let the palette close before opening another dialog.
    setTimeout(fn, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="overflow-hidden p-0 sm:top-[20%] sm:max-w-xl sm:translate-y-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Search and jump</DialogTitle>
        <Command loop className={group}>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              autoFocus
              placeholder="Search pages, accounts, categories, or type a payee…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-[60dvh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results
            </Command.Empty>
            {search.trim().length > 1 && (
              <Command.Group heading="Transactions">
                <Command.Item
                  value={`search transactions ${search}`}
                  onSelect={() =>
                    run(() => navigate({ to: '/transactions', search: { q: search.trim() } }))
                  }
                  className={item}
                >
                  <Search /> Search transactions for “{search.trim()}”
                </Command.Item>
              </Command.Group>
            )}
            {canWrite && (
              <Command.Group heading="Add">
                <Command.Item
                  onSelect={() => run(() => openNew({ mode: 'expense' }))}
                  className={item}
                >
                  <ArrowUpRight /> New expense
                </Command.Item>
                <Command.Item
                  onSelect={() => run(() => openNew({ mode: 'income' }))}
                  className={item}
                >
                  <ArrowDownLeft /> New income
                </Command.Item>
                <Command.Item
                  onSelect={() => run(() => openNew({ mode: 'transfer' }))}
                  className={item}
                >
                  <ArrowLeftRight /> New transfer
                </Command.Item>
              </Command.Group>
            )}
            <Command.Group heading="Go to">
              {[
                { to: '/', label: 'Home', icon: House },
                { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
                { to: '/budgets', label: 'Budgets', icon: Target },
                { to: '/reports', label: 'Reports', icon: ChartPie },
                { to: '/accounts', label: 'Accounts', icon: Landmark },
                { to: '/import', label: 'Import statement', icon: Upload },
                { to: '/settings', label: 'Settings', icon: Settings },
              ].map((p) => (
                <Command.Item
                  key={p.to}
                  value={`go ${p.label}`}
                  onSelect={() => run(() => navigate({ to: p.to }))}
                  className={item}
                >
                  <p.icon /> {p.label}
                </Command.Item>
              ))}
              <Command.Item
                value="needs review inbox"
                onSelect={() =>
                  run(() => navigate({ to: '/transactions', search: { needsReview: 'true' } }))
                }
                className={item}
              >
                <Inbox /> Needs review
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Accounts">
              {accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`account ${a.name}`}
                    onSelect={() =>
                      run(() =>
                        navigate({ to: '/accounts/$accountId', params: { accountId: a.id } }),
                      )
                    }
                    className={item}
                  >
                    <CategoryIcon icon={a.icon} color={a.color} size="sm" /> {a.name}
                  </Command.Item>
                ))}
            </Command.Group>
            <Command.Group heading="Categories">
              {groups.flatMap((g) =>
                g.categories
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`category ${c.name}`}
                      onSelect={() =>
                        run(() => navigate({ to: '/transactions', search: { categoryIds: c.id } }))
                      }
                      className={item}
                    >
                      <CategoryIcon icon={c.icon} color={c.color} size="sm" /> {c.name}
                    </Command.Item>
                  )),
              )}
            </Command.Group>
            <Command.Group heading="Preferences">
              <Command.Item
                value="toggle theme dark light"
                onSelect={() =>
                  run(() =>
                    setPreference(
                      document.documentElement.classList.contains('dark') ? 'light' : 'dark',
                    ),
                  )
                }
                className={item}
              >
                {preference === 'dark' ? <Sun /> : <Moon />} Toggle dark mode
              </Command.Item>
              <Command.Item
                value="keyboard shortcuts help"
                onSelect={() => run(onHelp)}
                className={item}
              >
                <Keyboard /> Keyboard shortcuts
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
