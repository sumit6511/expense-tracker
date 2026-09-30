import type { Transaction, TransactionChange } from '@et/shared';
import { ChevronDown, History } from 'lucide-react';
import { useState } from 'react';
import { useFormat } from '@/lib/format';
import {
  useAccountMap,
  useCategoryMap,
  useMemberNames,
  useTags,
  useTransactionHistory,
} from '@/lib/queries';

const ACTIONS: Record<TransactionChange['action'], string> = {
  update: 'edited',
  delete: 'moved it to the trash',
  restore: 'restored it',
  reconcile: 'reconciled it',
};

/** "Created", then every change, collapsed until asked for. */
export function TransactionHistory({ tx }: { tx: Transaction }) {
  const [open, setOpen] = useState(false);
  const history = useTransactionHistory(open ? tx.id : null);
  const f = useFormat();
  const describe = useDescribeChange(tx.currency);
  const people = useMemberNames();
  const by = people && tx.createdBy ? people.get(tx.createdBy) : undefined;

  const origin = `${
    tx.importBatchId
      ? 'Imported from a statement'
      : tx.recurringId
        ? 'Recorded from a recurring series'
        : 'Created'
  }${by ? ` by ${by}` : ''}`;

  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium"
        aria-expanded={open}
      >
        <History className="size-4 text-muted-foreground" /> History
        <ChevronDown
          className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ol className="grid grid-cols-1 gap-3 border-t px-3 py-3 text-sm">
          {history.isPending && <li className="text-muted-foreground">Loading…</li>}
          {history.data?.map((h) => (
            <li key={h.id} className="grid grid-cols-1 gap-0.5">
              <span>
                <span className="font-medium">{h.userName ?? 'Automatically'}</span>{' '}
                {ACTIONS[h.action]}
                <span className="text-muted-foreground"> · {when(h.at, f)}</span>
              </span>
              {Object.entries(h.changes).map(([field, [from, to]]) => (
                <span key={field} className="text-xs text-muted-foreground">
                  {describe(field, from, to)}
                </span>
              ))}
            </li>
          ))}
          <li className="text-muted-foreground">
            {origin} · {when(tx.createdAt, f)}
          </li>
        </ol>
      )}
    </div>
  );
}

function when(iso: string, f: ReturnType<typeof useFormat>) {
  const date = iso.slice(0, 10);
  const time = new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${f.relativeDate(date)} ${time}`;
}

function useDescribeChange(currency: string) {
  const f = useFormat();
  const accounts = useAccountMap();
  const categories = useCategoryMap();
  const { data: tags = [] } = useTags();
  const catName = (id: unknown) =>
    id === null ? 'Uncategorized' : (categories.get(String(id))?.name ?? 'a deleted category');
  const categoriesText = (v: unknown) => {
    const lines = (v as Array<[string | null, number?]>) ?? [];
    if (lines.length === 1) return catName(lines[0]![0]);
    return `split: ${lines.map(([c, a]) => `${catName(c)} ${f.money(Math.abs(a ?? 0), currency)}`).join(', ')}`;
  };
  return (field: string, from: unknown, to: unknown) => {
    switch (field) {
      case 'amount':
        return `Amount ${f.money(from as number, currency)} → ${f.money(to as number, currency)}`;
      case 'date':
        return `Date ${f.date(from as string)} → ${f.date(to as string)}`;
      case 'account':
        return `Account ${accounts.get(from as string)?.name ?? '?'} → ${accounts.get(to as string)?.name ?? '?'}`;
      case 'payee':
        return `Payee “${from ?? ''}” → “${to ?? ''}”`;
      case 'notes':
        return `Notes “${from}” → “${to}”`;
      case 'status':
        return `Status ${from} → ${to}`;
      case 'review':
        return to ? 'Marked for review' : 'Marked reviewed';
      case 'categories':
        return `Category ${categoriesText(from)} → ${categoriesText(to)}`;
      case 'tags': {
        const name = (id: string) => `#${tags.find((t) => t.id === id)?.name ?? '?'}`;
        const before = new Set(from as string[]);
        const after = new Set(to as string[]);
        const added = [...after].filter((t) => !before.has(t)).map(name);
        const removed = [...before].filter((t) => !after.has(t)).map(name);
        return [
          added.length && `Added ${added.join(' ')}`,
          removed.length && `Removed ${removed.join(' ')}`,
        ]
          .filter(Boolean)
          .join('; ');
      }
      default:
        return field;
    }
  };
}
