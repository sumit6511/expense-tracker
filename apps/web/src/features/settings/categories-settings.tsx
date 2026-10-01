import { type Category, type CategoryGroup, COLOR_SWATCHES } from '@et/shared';
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { CategoryIcon, ICON_NAMES, iconFor } from '@/components/icons';
import { CategoryPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/card';
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
  Segmented,
} from '@/components/ui/menu';
import { Select, SelectItem } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import {
  useCategories,
  useCreateCategory,
  useCreateCategoryGroup,
  useDeleteCategory,
  useDeleteCategoryGroup,
  useUpdateCategory,
  useUpdateCategoryGroup,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';

type Editing =
  | { type: 'category'; category?: Category; groupId: string }
  | { type: 'group'; group?: CategoryGroup }
  | { type: 'delete'; category: Category }
  | null;

export function CategoriesSettings() {
  const { data: groups, isPending } = useCategories();
  const canWrite = useCanWrite();
  const updateCategory = useUpdateCategory();
  const updateGroup = useUpdateCategoryGroup();
  const deleteGroup = useDeleteCategoryGroup();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Editing>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (isPending || !groups) return <Skeleton className="h-96" />;

  const run = (p: Promise<unknown>, message: string) =>
    p.then(() => toast.success(message)).catch((err) => toast.error(errorMessage(err)));

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Keep the list short: fewer categories make logging faster.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => setEditing({ type: 'group' })}>
              <Plus /> New group
            </Button>
          )}
        </div>
      </div>
      {(['expense', 'income'] as const).map((kind) => (
        <section key={kind} className="grid grid-cols-1 gap-3">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {kind === 'expense' ? 'Spending' : 'Income'}
          </h2>
          {groups
            .filter((g) => g.kind === kind && (showArchived || !g.archived))
            .map((g) => (
              <Card key={g.id} className={cn('overflow-hidden', g.archived && 'opacity-60')}>
                <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
                  <h3 className="text-sm font-semibold">
                    {g.name}{' '}
                    {g.archived && (
                      <span className="font-normal text-muted-foreground">(archived)</span>
                    )}
                  </h3>
                  {canWrite && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing({ type: 'category', groupId: g.id })}
                      >
                        <Plus /> Add
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`${g.name} options`}>
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onSelect={() => setEditing({ type: 'group', group: g })}
                          >
                            <Pencil /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                updateGroup.mutateAsync({ id: g.id, archived: !g.archived }),
                                g.archived ? 'Group restored' : 'Group archived',
                              )
                            }
                          >
                            {g.archived ? <ArchiveRestore /> : <Archive />}{' '}
                            {g.archived ? 'Unarchive' : 'Archive'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onSelect={async () => {
                              if (g.categories.length > 0) {
                                toast.error('Move or delete the categories in this group first');
                                return;
                              }
                              if (
                                await confirm({
                                  title: `Delete “${g.name}”?`,
                                  confirmLabel: 'Delete',
                                  destructive: true,
                                })
                              ) {
                                run(deleteGroup.mutateAsync(g.id), 'Group deleted');
                              }
                            }}
                          >
                            <Trash2 /> Delete group
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </header>
                <ul className="divide-y">
                  {g.categories
                    .filter((c) => showArchived || !c.archived)
                    .map((c) => (
                      <li
                        key={c.id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5',
                          c.archived && 'opacity-60',
                        )}
                      >
                        <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {c.name}
                          {c.archived && (
                            <span className="ml-1 text-muted-foreground">(archived)</span>
                          )}
                          {c.excludeFromReports && (
                            <Badge className="ml-1.5" title="Left out of reports">
                              <EyeOff className="size-3" /> Not in reports
                            </Badge>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.transactionCount} uses
                        </span>
                        {canWrite && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${c.name} options`}
                              >
                                <Ellipsis />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                onSelect={() =>
                                  setEditing({ type: 'category', category: c, groupId: g.id })
                                }
                              >
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  run(
                                    updateCategory.mutateAsync({ id: c.id, archived: !c.archived }),
                                    c.archived ? 'Category restored' : 'Category archived',
                                  )
                                }
                              >
                                {c.archived ? <ArchiveRestore /> : <Archive />}{' '}
                                {c.archived ? 'Unarchive' : 'Archive'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  run(
                                    updateCategory.mutateAsync({
                                      id: c.id,
                                      excludeFromReports: !c.excludeFromReports,
                                    }),
                                    c.excludeFromReports
                                      ? `${c.name} counts in reports again`
                                      : `${c.name} is left out of reports`,
                                  )
                                }
                              >
                                {c.excludeFromReports ? <Eye /> : <EyeOff />}{' '}
                                {c.excludeFromReports
                                  ? 'Include in reports'
                                  : 'Leave out of reports'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                destructive
                                onSelect={() => setEditing({ type: 'delete', category: c })}
                              >
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </li>
                    ))}
                  {g.categories.length === 0 && (
                    <li className="px-4 py-3 text-sm text-muted-foreground">No categories yet.</li>
                  )}
                </ul>
              </Card>
            ))}
        </section>
      ))}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing?.type === 'category' && (
          <CategoryDialog
            groups={groups}
            category={editing.category}
            groupId={editing.groupId}
            onDone={() => setEditing(null)}
          />
        )}
        {editing?.type === 'group' && (
          <GroupDialog group={editing.group} onDone={() => setEditing(null)} />
        )}
        {editing?.type === 'delete' && (
          <DeleteCategoryDialog category={editing.category} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}

function CategoryDialog({
  groups,
  category,
  groupId: initialGroup,
  onDone,
}: {
  groups: CategoryGroup[];
  category?: Category;
  groupId: string;
  onDone: () => void;
}) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [name, setName] = useState(category?.name ?? '');
  const [groupId, setGroupId] = useState(category?.groupId ?? initialGroup);
  const [icon, setIcon] = useState(category?.icon ?? 'tag');
  const [color, setColor] = useState(category?.color ?? COLOR_SWATCHES[0]!);
  const kind = groups.find((g) => g.id === initialGroup)?.kind;
  const pending = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (category)
        await update.mutateAsync({ id: category.id, name: name.trim(), groupId, icon, color });
      else await create.mutateAsync({ name: name.trim(), groupId, icon, color });
      toast.success(category ? 'Category updated' : 'Category added');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{category ? 'Edit category' : 'New category'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <div className="flex items-center gap-3">
            <CategoryIcon icon={icon} color={color} size="lg" />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoFocus
              required
              maxLength={60}
              aria-label="Name"
            />
          </div>
          <Field label="Group" htmlFor="cat-group">
            <Select id="cat-group" value={groupId} onValueChange={setGroupId}>
              {groups
                .filter((g) => g.kind === kind)
                .map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-2">
            <span className="text-[13px] font-medium">Icon</span>
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
              {ICON_NAMES.map((n) => {
                const Icon = iconFor(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={n}
                    aria-pressed={icon === n}
                    onClick={() => setIcon(n)}
                    className={cn(
                      'grid grid-cols-1 aspect-square place-items-center rounded-lg border hover:bg-muted',
                      icon === n && 'border-primary bg-accent',
                    )}
                  >
                    <Icon className="size-4" style={{ color }} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <span className="text-[13px] font-medium">Colour</span>
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
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function GroupDialog({ group, onDone }: { group?: CategoryGroup; onDone: () => void }) {
  const create = useCreateCategoryGroup();
  const update = useUpdateCategoryGroup();
  const [name, setName] = useState(group?.name ?? '');
  const [kind, setKind] = useState<'expense' | 'income'>(group?.kind ?? 'expense');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (group) await update.mutateAsync({ id: group.id, name: name.trim() });
      else await create.mutateAsync({ name: name.trim(), kind });
      toast.success(group ? 'Group renamed' : 'Group added');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{group ? 'Rename group' : 'New category group'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Field label="Name" htmlFor="group-name">
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              maxLength={60}
            />
          </Field>
          {!group && (
            <Field label="Kind">
              <Segmented
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'expense', label: 'Spending' },
                  { value: 'income', label: 'Income' },
                ]}
              />
            </Field>
          )}
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

function DeleteCategoryDialog({ category, onDone }: { category: Category; onDone: () => void }) {
  const remove = useDeleteCategory();
  const [target, setTarget] = useState<string | null>(null);
  const used = category.transactionCount > 0;
  async function submit() {
    try {
      await remove.mutateAsync({
        id: category.id,
        reassignTo: used ? (target ?? 'none') : undefined,
      });
      toast.success('Category deleted');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete “{category.name}”?</DialogTitle>
        <DialogDescription>
          {used
            ? `${category.transactionCount} transactions use it. Choose where they should go.`
            : 'No transactions use this category.'}
        </DialogDescription>
      </DialogHeader>
      {used && (
        <DialogBody>
          <CategoryPicker value={target} onChange={setTarget} placeholder="Leave uncategorized" />
          <p className="mt-2 text-xs text-muted-foreground">
            Tip: archiving hides a category but keeps its history.
          </p>
        </DialogBody>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={submit}
          disabled={remove.isPending || target === category.id}
        >
          Delete
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
