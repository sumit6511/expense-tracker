import { ArrowLeft, ArrowRight, Compass, PartyPopper, Plus, X } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTransactionDialog } from '@/features/transactions/transaction-dialog';
import { useT } from '@/lib/i18n';
import { useUpdateMe } from '@/lib/queries';
import { useCanWrite, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/*
 * The getting-started tour: a welcome, then a spotlight on the main parts of the app with a
 * short note beside each, ending with an invitation to record the first expense. It starts by
 * itself the first time someone opens the app (until they finish or skip it, which is saved on
 * their account) and can be taken again from the profile menu or the command palette.
 *
 * Steps point at elements marked `data-tour="…"`. Desktop and phones show different navigation,
 * so a step whose element isn't on screen is simply left out.
 */

interface Step {
  /** The `data-tour` mark of the element to point at; without one the step is a centred card. */
  target?: string;
  title: string;
  body: string;
  /** A keyboard shortcut, mentioned only on devices with a keyboard and mouse. */
  keys?: string;
  /** Only for people who can add and change things (not viewers). */
  write?: boolean;
}

const STEPS: Step[] = [
  {
    title: 'Welcome, {name}',
    body: 'Here’s a one-minute look around: where to record spending, see where it goes, and plan ahead.',
  },
  {
    target: 'add',
    write: true,
    title: 'Add a transaction',
    body: 'Record spending, income or a transfer between your accounts in a few taps.',
    keys: 'On a keyboard, press N from anywhere.',
  },
  {
    target: 'search',
    title: 'Search & jump',
    body: 'Go to any page, account or category, or find a past transaction.',
    keys: 'On a keyboard: Ctrl K (⌘K on a Mac).',
  },
  {
    target: 'nav-transactions',
    title: 'Transactions',
    body: 'Everything you’ve recorded, with search and filters. Select several to change them at once.',
  },
  {
    target: 'nav-inbox',
    title: 'Review',
    body: 'Imported transactions wait here for a quick check. Rules can sort them into categories for you.',
  },
  {
    target: 'nav-budgets',
    title: 'Budgets and goals',
    body: 'Set a monthly budget for each category and see what’s left to spend. Save towards goals, too.',
  },
  {
    target: 'nav-reports',
    title: 'Reports',
    body: 'Where your money went, cash flow and net worth over time, and a monthly report you can print.',
  },
  {
    target: 'nav-import',
    title: 'Import',
    body: 'Bring in a bank statement (Excel, CSV or OFX), or paste the SMS alerts from your bank, eSewa or Khalti.',
  },
  {
    target: 'nav-more',
    title: 'More',
    body: 'Review, recurring bills, splitting with friends, reports, accounts, import and settings are here.',
  },
  {
    target: 'workspace',
    title: 'Your workspace',
    body: 'Accounts, budgets and reports live in a workspace. Invite family to share it, or keep separate ones for home and business.',
  },
  {
    target: 'nav-settings',
    title: 'Settings',
    body: 'Categories, rules, currency, the BS or AD calendar, language (नेपाली) and notifications.',
  },
  {
    title: 'Ready to start',
    body: 'A good first step: add something you spent today. You can take this tour again any time from the menu.',
  },
];

/** A mouse or trackpad suggests a keyboard too (phones and tablets get no shortcut tips). */
function hasKeyboard() {
  return matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** The visible element with this mark (navigation differs between desktop and phones). */
function findTarget(mark: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${mark}"]`)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden') {
      return el;
    }
  }
  return null;
}

interface TourValue {
  startTour: () => void;
}

const TourContext = createContext<TourValue | null>(null);

export function useTour(): TourValue {
  const value = useContext(TourContext);
  if (!value) throw new Error('useTour must be used inside TourProvider');
  return value;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const canWrite = useCanWrite();
  const updateMe = useUpdateMe();
  // The steps that apply on this screen, worked out when the tour starts.
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);

  const startTour = useCallback(() => {
    toast.dismiss();
    setSteps(
      STEPS.filter((s) => (!s.write || canWrite) && (!s.target || findTarget(s.target) !== null)),
    );
    setIndex(0);
  }, [canWrite]);

  // First visit: start once the app has drawn its navigation.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (me.user.tourCompleted || autoStarted.current) return;
    const timer = setTimeout(() => {
      autoStarted.current = true;
      startTour();
    }, 600);
    return () => clearTimeout(timer);
  }, [me.user.tourCompleted, startTour]);

  const finish = useCallback(() => {
    setSteps(null);
    if (!me.user.tourCompleted) updateMe.mutate({ tourCompleted: true });
  }, [me.user.tourCompleted, updateMe]);

  const value = useMemo(() => ({ startTour }), [startTour]);
  return (
    <TourContext.Provider value={value}>
      {children}
      {steps && steps.length > 0 && (
        <TourStep
          steps={steps}
          index={index}
          onBack={() => setIndex((i) => Math.max(0, i - 1))}
          onNext={() => (index + 1 < steps.length ? setIndex(index + 1) : finish())}
          onClose={finish}
        />
      )}
    </TourContext.Provider>
  );
}

function TourStep({
  steps,
  index,
  onBack,
  onNext,
  onClose,
}: {
  steps: Step[];
  index: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const step = steps[index]!;
  const target = step.target ? findTarget(step.target) : null;

  // Arrow keys move through the tour (Escape closes it: each surface handles that itself).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        onBack();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, onBack, onNext]);

  if (!target) {
    return <CenteredStep steps={steps} index={index} onNext={onNext} onClose={onClose} />;
  }
  return (
    <SpotlightStep
      target={target}
      steps={steps}
      index={index}
      onBack={onBack}
      onNext={onNext}
      onClose={onClose}
    />
  );
}

/** The welcome and the last step: a card in the middle of the screen. */
function CenteredStep({
  steps,
  index,
  onNext,
  onClose,
}: {
  steps: Step[];
  index: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { me } = useSession();
  const canWrite = useCanWrite();
  const { openNew } = useTransactionDialog();
  const step = steps[index]!;
  const first = index === 0;
  const last = index === steps.length - 1;
  const Icon = last ? PartyPopper : Compass;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="tour" hideClose>
        <div className="flex flex-col items-center px-6 pt-8 pb-2 text-center">
          <span className="mb-4 grid size-14 grid-cols-1 place-items-center rounded-2xl bg-accent text-accent-foreground">
            <Icon className="size-7" />
          </span>
          <DialogTitle className="text-lg">
            {t(step.title, { name: me.user.name.split(' ')[0] ?? '' })}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-sm text-balance">
            {t(step.body)}
          </DialogDescription>
          {steps.length > 2 && <Dots steps={steps} index={index} className="mt-5" />}
        </div>
        <div className="flex flex-col-reverse gap-2 px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-center">
          {first ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t('Skip tour')}
              </Button>
              <Button onClick={onNext} autoFocus>
                {t('Show me around')} <ArrowRight />
              </Button>
            </>
          ) : last && canWrite ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t('Done')}
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  onClose();
                  // Let the tour close before the next dialog opens.
                  setTimeout(() => openNew({ mode: 'expense' }), 0);
                }}
              >
                <Plus /> {t('Add first expense')}
              </Button>
            </>
          ) : (
            <Button onClick={onNext} autoFocus>
              {last ? t('Done') : t('Next')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Dims the page except for one element, with a note beside it. */
function SpotlightStep({
  target,
  steps,
  index,
  onBack,
  onNext,
  onClose,
}: {
  target: HTMLElement;
  steps: Step[];
  index: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const step = steps[index]!;
  const rect = useLiveRect(target);
  const anchor = useRef(target);
  anchor.current = target;
  const next = useRef<HTMLButtonElement>(null);
  const last = index === steps.length - 1;

  // Beside sidebar items, above the bottom bar on phones, below anything else.
  const side =
    rect.top > window.innerHeight * 0.6
      ? 'top'
      : rect.right < window.innerWidth / 3 && window.innerWidth >= 768
        ? 'right'
        : 'bottom';
  const pad = 6;

  return (
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={anchor} />
      {createPortal(
        <>
          {/* Catches clicks so the page underneath stays as it is during the tour. */}
          <div className="fixed inset-0 z-[60]" aria-hidden />
          <div
            aria-hidden
            className="pointer-events-none fixed z-[60] rounded-xl transition-all duration-300 ease-out [--tour-dim:rgb(0_0_0/0.5)] motion-reduce:transition-none dark:[--tour-dim:rgb(0_0_0/0.72)]"
            style={{
              top: rect.top - pad,
              left: rect.left - pad,
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
              // Everything but the spotlit element is dimmed; the outline marks it.
              boxShadow: '0 0 0 9999px var(--tour-dim)',
              outline: '2px solid var(--primary)',
            }}
          />
        </>,
        document.body,
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align="center"
          sideOffset={pad + 10}
          collisionPadding={12}
          data-testid="tour"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            next.current?.focus();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={onClose}
          className="z-[61] w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl outline-none data-[state=open]:animate-in"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground tabular">
              {t('{n} of {total}', { n: index + 1, total: steps.length })}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('Close tour')}
              className="-mt-1 -mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <h2 id="tour-title" className="mt-1 text-base font-semibold">
            {t(step.title)}
          </h2>
          <p id="tour-body" className="mt-1 text-sm text-muted-foreground">
            {t(step.body)}
            {step.keys && hasKeyboard() && ` ${t(step.keys)}`}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Dots steps={steps} index={index} />
            <div className="ml-auto flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('Back')}>
                <ArrowLeft />
              </Button>
              <Button ref={next} size="sm" onClick={onNext}>
                {last ? t('Done') : t('Next')}
                {!last && <ArrowRight />}
              </Button>
            </div>
          </div>
          <PopoverPrimitive.Arrow className="fill-popover" width={14} height={7} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Where an element is on screen, kept up to date as the page scrolls or resizes. */
function useLiveRect(el: HTMLElement): DOMRect {
  const [rect, setRect] = useState(() => el.getBoundingClientRect());
  useLayoutEffect(() => {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect(el.getBoundingClientRect()));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [el]);
  return rect;
}

function Dots({ steps, index, className }: { steps: Step[]; index: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)} aria-hidden>
      {steps.map((s, i) => (
        <span
          key={s.title}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i === index ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30',
          )}
        />
      ))}
    </div>
  );
}
