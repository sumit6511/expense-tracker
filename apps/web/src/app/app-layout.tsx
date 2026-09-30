import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  ChartPie,
  ChevronsUpDown,
  House,
  Inbox,
  Landmark,
  Loader2,
  LogOut,
  type LucideIcon,
  Menu,
  Plus,
  Repeat,
  Search,
  Settings,
  Target,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { RecurringDialogProvider } from '@/features/recurring/recurring-dialog';
import { RuleDialogProvider } from '@/features/rules/rule-dialog';
import {
  TransactionDialogProvider,
  useTransactionDialog,
} from '@/features/transactions/transaction-dialog';
import { ApiError, authApi } from '@/lib/api';
import { useMeQuery, useReviewCounts } from '@/lib/queries';
import {
  pickWorkspace,
  rememberWorkspace,
  SessionProvider,
  useCanWrite,
  useSession,
} from '@/lib/session';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/inbox', label: 'Review', icon: Inbox },
  { to: '/budgets', label: 'Budgets', icon: Target },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/reports', label: 'Reports', icon: ChartPie },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/import', label: 'Import', icon: Upload },
];

// Phones show these in the bottom bar (around the add button); the rest go under "More".
const BOTTOM_PATHS = ['/', '/transactions', '/budgets'];
const BOTTOM_NAV = BOTTOM_PATHS.map((to) => NAV.find((n) => n.to === to)!);
const MORE_NAV: NavItem[] = [
  ...NAV.filter((n) => !BOTTOM_PATHS.includes(n.to)),
  { to: '/settings', label: 'Settings', icon: Settings },
];

function ReviewBadge() {
  const { data } = useReviewCounts();
  if (!data?.needsReview) return null;
  return (
    <span className="ml-auto rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground tabular">
      {data.needsReview > 99 ? '99+' : data.needsReview}
    </span>
  );
}

/** Loads the signed-in user and workspace, then renders the app chrome. */
export function AppLayout() {
  const me = useMeQuery();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const switchWorkspace = useCallback((id: string) => {
    rememberWorkspace(id);
    setWorkspaceId(id);
  }, []);

  if (me.isPending) return <FullPageSpinner />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401)
      return <Navigate to="/login" search={{}} />;
    return (
      <div className="grid grid-cols-1 min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Couldn’t reach the server</p>
          <p className="mt-1 text-sm text-muted-foreground">{me.error.message}</p>
          <Button className="mt-4" onClick={() => me.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  const data = me.data;
  const workspace = data.workspaces.find((w) => w.id === workspaceId) ?? pickWorkspace(data);
  if (!workspace) return <Navigate to="/onboarding" />;

  return (
    <SessionProvider me={data} workspace={workspace} onSwitch={switchWorkspace}>
      <RuleDialogProvider>
        <RecurringDialogProvider>
          <TransactionDialogProvider>
            <Shell />
          </TransactionDialogProvider>
        </RecurringDialogProvider>
      </RuleDialogProvider>
    </SessionProvider>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid grid-cols-1 min-h-dvh place-items-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { openNew } = useTransactionDialog();
  const canWrite = useCanWrite();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]'))
        return;
      if (e.key === 'n' && canWrite) {
        e.preventDefault();
        openNew({ mode: 'expense' });
      } else if (e.key === 'i' && canWrite) {
        e.preventDefault();
        openNew({ mode: 'income' });
      } else if (e.key === 't' && canWrite) {
        e.preventDefault();
        openNew({ mode: 'transfer' });
      } else if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openNew, canWrite]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-card/50 px-3 py-4 lg:flex">
        <WorkspaceMenu />
        {canWrite && (
          <Button className="mt-4 w-full justify-start" onClick={() => openNew()}>
            <Plus /> New transaction
            <kbd className="ml-auto rounded bg-primary-foreground/20 px-1.5 text-[11px]">N</kbd>
          </Button>
        )}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mt-2 flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground hover:bg-muted"
        >
          <Search className="size-4" /> Search & jump
          <kbd className="ml-auto text-[11px]">⌘K</kbd>
        </button>
        <nav className="mt-4 grid grid-cols-1 gap-0.5" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[18px]',
                isActive(pathname, item.to) && 'bg-accent text-accent-foreground hover:bg-accent',
              )}
            >
              <item.icon /> {item.label}
              {item.to === '/inbox' && <ReviewBadge />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto grid grid-cols-1 gap-0.5">
          <Link
            to="/settings"
            className={cn(
              'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[18px]',
              isActive(pathname, '/settings') && 'bg-accent text-accent-foreground',
            )}
          >
            <Settings /> Settings
          </Link>
          <UserMenu />
        </div>
      </aside>

      {/* Main */}
      <div className="min-w-0 pb-24 lg:pb-8">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <WorkspaceMenu compact />
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label="Search"
            onClick={() => setPaletteOpen(true)}
          >
            <Search />
          </Button>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Bottom navigation (phones & tablets) */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card/95 backdrop-blur safe-bottom lg:hidden"
      >
        {BOTTOM_NAV.slice(0, 2).map((item) => (
          <BottomLink key={item.to} item={item} active={isActive(pathname, item.to)} />
        ))}
        <div className="grid grid-cols-1 place-items-center">
          {canWrite && (
            <button
              type="button"
              aria-label="Add transaction"
              onClick={() => openNew()}
              className="-mt-5 grid grid-cols-1 size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background active:scale-95"
            >
              <Plus className="size-7" />
            </button>
          )}
        </div>
        <BottomLink item={BOTTOM_NAV[2]!} active={isActive(pathname, BOTTOM_NAV[2]!.to)} />
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground',
            MORE_NAV.some((item) => isActive(pathname, item.to)) && 'text-primary',
          )}
        >
          <Menu className="size-5" /> More
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 gap-2 pb-6">
            {MORE_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-xl border p-4 text-sm font-medium hover:bg-muted [&_svg]:size-5 [&_svg]:text-primary"
              >
                <item.icon /> {item.label}
                {item.to === '/inbox' && <ReviewBadge />}
              </Link>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onHelp={() => setHelpOpen(true)}
      />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground',
        active && 'text-primary',
      )}
    >
      <item.icon className="size-5" /> {item.label}
    </Link>
  );
}

function WorkspaceMenu({ compact }: { compact?: boolean }) {
  const { me, workspace, switchWorkspace } = useSession();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex min-w-0 items-center gap-2.5 rounded-lg text-left hover:bg-muted',
            compact ? 'px-1.5 py-1' : 'w-full px-2 py-1.5',
          )}
        >
          <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{workspace.name}</span>
            {!compact && (
              <span className="block truncate text-xs text-muted-foreground">
                {workspace.baseCurrency} ·{' '}
                {workspace.calendar === 'bs' ? 'Bikram Sambat' : 'Gregorian'}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {me.workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => switchWorkspace(w.id)}>
            <span
              className={cn(
                'size-2 rounded-full',
                w.id === workspace.id ? 'bg-primary' : 'bg-transparent',
              )}
            />
            <span className="truncate">{w.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{w.baseCurrency}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: '/onboarding' })}>
          <Plus /> New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await authApi.signOut().catch(() => undefined);
    queryClient.clear();
    navigate({ to: '/login', search: {} });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
        >
          <span className="grid grid-cols-1 size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {me.user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 truncate text-sm">{me.user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{me.user.email}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => navigate({ to: '/settings', search: { tab: 'profile' } })}
        >
          <Settings /> Profile & security
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['N', 'New expense'],
  ['I', 'New income'],
  ['T', 'New transfer'],
  ['⌘/Ctrl K', 'Search & jump'],
  ['/', 'Search transactions (on the Transactions page)'],
  ['?', 'Show this help'],
];

function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <dl className="grid grid-cols-1 gap-2 pb-2">
            {SHORTCUTS.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>
                  <kbd className="rounded-md border bg-muted px-2 py-0.5 text-xs font-medium">
                    {key}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
