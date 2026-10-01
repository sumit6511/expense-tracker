import { COLOR_SWATCHES, type Payee, type Tag } from '@et/shared';
import { Link } from '@tanstack/react-router';
import { Ellipsis, Merge, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CategoryIcon } from '@/components/icons';
import { CategoryPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useConfirm,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Select, SelectItem } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useCategoryMap,
  useCreateTag,
  useDeletePayee,
  useDeleteTag,
  useMergePayee,
  usePayees,
  useTags,
  useUpdatePayee,
  useUpdateTag,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';

export function PayeesSettings() {
  const { data: payees, isPending } = usePayees();
  const categories = useCategoryMap();
  const f = useFormat();
  const canWrite = useCanWrite();
  const remove = useDeletePayee();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ payee: Payee; mode: 'edit' | 'merge' } | null>(null);
  const filtered = useMemo(
    () => (payees ?? []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())),
    [payees, query],
  );

  if (isPending || !payees) return <Skeleton className="h-96" />;

  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">
        Set a default category so new transactions from a payee are categorized for you. Merge
        duplicates like “Daraz” and “DARAZ ONLINE”.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${payees.length} payees`}
          className="pl-9"
        />
      </div>
      <Card className="divide-y overflow-hidden">
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No payees found.</p>
        )}
        {filtered.slice(0, 300).map((p) => {
          const cat = p.suggestedCategoryId ? categories.get(p.suggestedCategoryId) : undefined;
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <Link
                  to="/transactions"
                  search={{ payeeIds: p.id }}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {p.name}
                </Link>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {p.transactionCount} transactions
                  {p.lastUsed ? ` · last ${f.relativeDate(p.lastUsed)}` : ''}
                </span>
              </span>
              {cat && (
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                  <CategoryIcon icon={cat.icon} color={cat.color} size="sm" />
                  {cat.name}
                  {!p.defaultCategoryId && <span className="italic">(learned)</span>}
                </span>
              )}
              {canWrite && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`${p.name} options`}>
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setEditing({ payee: p, mode: 'edit' })}>
                      <Pencil /> Rename / default category
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setEditing({ payee: p, mode: 'merge' })}>
                      <Merge /> Merge into…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={async () => {
                        const ok = await confirm({
                          title: `Delete “${p.name}”?`,
                          description: 'Its transactions are kept, just without a payee.',
                          confirmLabel: 'Delete',
                          destructive: true,
                        });
                        if (ok)
                          remove.mutate(p.id, { onError: (e) => toast.error(errorMessage(e)) });
                      }}
                    >
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </Card>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing?.mode === 'edit' && (
          <PayeeDialog payee={editing.payee} onDone={() => setEditing(null)} />
        )}
        {editing?.mode === 'merge' && (
          <MergeDialog payee={editing.payee} payees={payees} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}

function PayeeDialog({ payee, onDone }: { payee: Payee; onDone: () => void }) {
  const update = useUpdatePayee();
  const [name, setName] = useState(payee.name);
  const [categoryId, setCategoryId] = useState<string | null>(payee.defaultCategoryId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({ id: payee.id, name: name.trim(), defaultCategoryId: categoryId });
      toast.success('Payee updated');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>Edit payee</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Field
            label="Name"
            htmlFor="payee-name"
            hint="Renaming to an existing payee merges the two."
          >
            <Input
              id="payee-name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Default category">
            <CategoryPicker
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Learn from history"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={update.isPending || !name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function MergeDialog({
  payee,
  payees,
  onDone,
}: {
  payee: Payee;
  payees: Payee[];
  onDone: () => void;
}) {
  const merge = useMergePayee();
  const [target, setTarget] = useState('');
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Merge “{payee.name}”</DialogTitle>
        <DialogDescription>
          Its {payee.transactionCount} transactions move to the payee you pick, then it’s removed.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Select
          value={target}
          onValueChange={setTarget}
          aria-label="Merge into"
          placeholder="Choose payee"
        >
          {payees
            .filter((p) => p.id !== payee.id)
            .map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
        </Select>
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={!target || merge.isPending}
          onClick={() =>
            merge.mutate(
              { id: payee.id, targetId: target },
              {
                onSuccess: () => {
                  toast.success('Payees merged');
                  onDone();
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        >
          Merge
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function TagsSettings() {
  const { data: tags, isPending } = useTags();
  const canWrite = useCanWrite();
  const create = useCreateTag();
  const remove = useDeleteTag();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Tag | null>(null);

  if (isPending || !tags) return <Skeleton className="h-64" />;

  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">
        Tags cut across categories, e.g. #dashain-2083, #trip-pokhara or #tax-deductible.
      </p>
      {canWrite && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate(
              { name: name.trim(), color: COLOR_SWATCHES[tags.length % COLOR_SWATCHES.length] },
              { onSuccess: () => setName(''), onError: (err) => toast.error(errorMessage(err)) },
            );
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New tag name"
            maxLength={40}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus /> Add
          </Button>
        </form>
      )}
      <Card className="divide-y overflow-hidden">
        {tags.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No tags yet.</p>
        )}
        {tags.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="size-3 rounded-full" style={{ backgroundColor: t.color }} />
            <Link
              to="/transactions"
              search={{ tagIds: t.id }}
              className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
            >
              #{t.name}
            </Link>
            <span className="text-xs text-muted-foreground">{t.transactionCount}</span>
            {canWrite && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${t.name}`}
                  onClick={() => setEditing(t)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${t.name}`}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete #${t.name}?`,
                        description: 'It’s removed from its transactions.',
                        confirmLabel: 'Delete',
                        destructive: true,
                      })
                    ) {
                      remove.mutate(t.id, { onError: (e) => toast.error(errorMessage(e)) });
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        ))}
      </Card>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && <TagDialog tag={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function TagDialog({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const update = useUpdateTag();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  return (
    <DialogContent aria-describedby={undefined}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate(
            { id: tag.id, name: name.trim(), color },
            { onSuccess: onDone, onError: (err) => toast.error(errorMessage(err)) },
          );
        }}
      >
        <DialogHeader>
          <DialogTitle>Edit tag</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
            required
            maxLength={40}
          />
          <div className="flex flex-wrap gap-1.5">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn(
                  'size-7 rounded-full ring-offset-2 ring-offset-popover',
                  color === c && 'ring-2 ring-foreground',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
