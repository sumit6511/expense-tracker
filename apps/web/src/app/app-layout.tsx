import {
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import {
  ArrowLeftRight,
  ChartPie,
  ChevronsUpDown,
  Compass,
  Handshake,
  House,
  Inbox,
  Landmark,
  Lightbulb,
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { UserAvatar } from '@/components/person';
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
import { NotificationBell } from '@/features/notifications/notification-bell';
import { RecurringDialogProvider } from '@/features/recurring/recurring-dialog';
import { RuleDialogProvider } from '@/features/rules/rule-dialog';
import { TourProvider, useTour } from '@/features/tour/tour';
import {
  TransactionDialogProvider,
  useTransactionDialog,
} from '@/features/transactions/transaction-dialog';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useMeQuery, useReviewCounts } from '@/lib/queries';
import {
  pickWorkspace,
  rememberWorkspace,
  SessionProvider,
  useCanWrite,
  useSession,
} from '@/lib/session';
import { takeSharedReceipts } from '@/lib/shared-receipts';
import { useSignOut } from '@/lib/sign-out';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { OutboxBanner } from './outbox-banner';

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
  { to: '/split', label: 'Split', icon: Handshake },
  { to: '/reports', label: 'Reports', icon: ChartPie },
  { to: '/insights', label: 'Insights', icon: Lightbulb },
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
    <span className="ml-auto rounded-full bg-primary px-1.5 py-px text-2xs font-semibold text-primary-foreground tabular">
      {data.needsReview > 99 ? '99+' : data.needsReview}
    </span>
  );
}

/** Loads the signed-in user and workspace, then renders the app chrome. */
export function AppLayout() {
  const me = useMeQuery();
  const router = useRouter();
  // Links from push notifications say which workspace they're about (?ws=…).
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => {
    const ws = new URLSearchParams(window.location.search).get('ws');
    if (ws) rememberWorkspace(ws);
    return ws;
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('ws')) return;
    url.searchParams.delete('ws');
    router.history.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [router]);
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
            <TourProvider>
              <Shell />
            </TourProvider>
          </TransactionDialogProvider>
        </RecurringDialogProvider>
      </RuleDialogProvider>
    </SessionProvider>
  );
}

/** Focuses the page's heading (or the main area): the start of the content. */
function focusPageStart() {
  const main = document.getElementById('main');
  const target = main?.querySelector<HTMLElement>('h1') ?? main;
  if (!target) return false;
  if (target !== main && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return target !== main;
}

/** The same once a newly opened page has rendered (pages load lazily); returns a cancel. */
function focusPageStartSoon() {
  let tries = 0;
  const timer = window.setInterval(() => {
    // A dialog opened in the meantime keeps its focus.
    if (document.querySelector('[role="dialog"]')) return window.clearInterval(timer);
    if (focusPageStart() || ++tries > 20) window.clearInterval(timer);
  }, 50);
  return () => window.clearInterval(timer);
}

export function FullPageSpinner() {
  return (
    <div className="grid grid-cols-1 min-h-dvh place-items-center">
      <Loader2
        className="size-6 animate-spin text-muted-foreground"
        role="img"
        aria-label="Loading"
      />
    </div>
  );
}

/** How the getting-started tour finds a navigation link, e.g. "nav-budgets". */
function tourMark(to: string) {
  return `nav-${to.slice(1) || 'home'}`;
}

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const t = useT();
  const { me } = useSession();
  // Screen readers and hyphenation follow the chosen language.
  useEffect(() => {
    document.documentElement.lang = me.user.locale;
  }, [me.user.locale]);
  const { openNew } = useTransactionDialog();
  const canWrite = useCanWrite();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { startTour } = useTour();
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

  // After moving to another page, put focus on its heading so screen readers announce where you
  // are (and Tab continues from the content, not the menu you clicked). Not on the first load.
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    return focusPageStartSoon();
  }, [pathname]);

  // A receipt shared to the installed app (public/share-sw.js) starts a new expense with it.
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('shared')) return;
    url.searchParams.delete('shared');
    router.history.replace(`${url.pathname}${url.search}${url.hash}`);
    if (!canWrite) return;
    void takeSharedReceipts().then(({ files, text }) => {
      if (files.length || text) openNew({ mode: 'expense', files, ...(text && { notes: text }) });
    });
  }, [router, openNew, canWrite]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr] print:block">
      <button
        type="button"
        onClick={() => focusPageStart()}
        className="fixed top-3 left-3 z-[70] -translate-y-24 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md focus:translate-y-0 print:hidden"
      >
        {t('Skip to content')}
      </button>
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-card/50 px-3 py-4 lg:flex print:hidden">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <WorkspaceMenu />
          </div>
          <NotificationBell />
        </div>
        {canWrite && (
          <Button className="mt-4 w-full justify-start" onClick={() => openNew()} data-tour="add">
            <Plus /> {t('New transaction')}
            <kbd className="ml-auto rounded bg-primary-foreground/20 px-1.5 text-2xs">N</kbd>
          </Button>
        )}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          data-tour="search"
          className="mt-2 flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground hover:bg-muted"
        >
          <Search className="size-4" /> {t('Search & jump')}
          <kbd className="ml-auto text-2xs">⌘K</kbd>
        </button>
        <nav className="mt-4 grid grid-cols-1 gap-0.5" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              data-tour={tourMark(item.to)}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[18px]',
                isActive(pathname, item.to) && 'bg-accent text-accent-foreground hover:bg-accent',
              )}
            >
              <item.icon /> {t(item.label)}
              {item.to === '/inbox' && <ReviewBadge />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto grid grid-cols-1 gap-0.5">
          <Link
            to="/settings"
            data-tour="nav-settings"
            className={cn(
              'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[18px]',
              isActive(pathname, '/settings') && 'bg-accent text-accent-foreground',
            )}
          >
            <Settings /> {t('Settings')}
          </Link>
          <UserMenu />
        </div>
      </aside>

      {/* Main */}
      <div className="min-w-0 pb-24 lg:pb-8 print:pb-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:hidden print:hidden">
          <WorkspaceMenu compact />
          <NotificationBell align="end" className="ml-auto" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('Search')}
            onClick={() => setPaletteOpen(true)}
            data-tour="search"
          >
            <Search />
          </Button>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[100rem] px-4 pt-5 outline-none sm:px-6 lg:px-8 lg:pt-8 print:max-w-none print:p-0"
        >
          <OutboxBanner />
          <Outlet />
        </main>
      </div>

      {/* Bottom navigation (phones & tablets) */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card/95 backdrop-blur safe-bottom lg:hidden print:hidden"
      >
        {BOTTOM_NAV.slice(0, 2).map((item) => (
          <BottomLink key={item.to} item={item} active={isActive(pathname, item.to)} />
        ))}
        <div className="grid grid-cols-1 place-items-center">
          {canWrite && (
            <button
              type="button"
              aria-label={t('Add transaction')}
              onClick={() => openNew()}
              data-tour="add"
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
          data-tour="nav-more"
          className={cn(
            'flex h-16 flex-col items-center justify-center gap-1 text-2xs font-medium text-muted-foreground',
            MORE_NAV.some((item) => isActive(pathname, item.to)) && 'text-primary',
          )}
        >
          <Menu className="size-5" /> {t('More')}
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('More')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 gap-2 pb-6">
            {MORE_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-xl border p-4 text-sm font-medium hover:bg-muted [&_svg]:size-5 [&_svg]:text-primary"
              >
                <item.icon /> {t(item.label)}
                {item.to === '/inbox' && <ReviewBadge />}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                // Let the sheet close first: the tour points at the navigation behind it.
                setTimeout(startTour, 250);
              }}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4"
            >
              <Compass /> {t('Take the tour')}
            </button>
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
  const t = useT();
  return (
    <Link
      to={item.to}
      data-tour={tourMark(item.to)}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-1 text-2xs font-medium text-muted-foreground',
        active && 'text-primary',
      )}
    >
      <item.icon className="size-5" /> {t(item.label)}
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
          data-tour="workspace"
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
  const { startTour } = useTour();
  const navigate = useNavigate();
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
        >
          <UserAvatar id={me.user.id} name={me.user.name} avatar={me.user.avatar} size="sm" />
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
        <DropdownMenuItem onSelect={startTour}>
          <Compass /> Take the tour
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
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
