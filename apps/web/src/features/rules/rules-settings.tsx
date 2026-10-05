import type { Rule } from '@et/shared';
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  ListFilter,
  Pencil,
  Play,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useApplyRule,
  useDeleteRule,
  useReorderRules,
  useRules,
  useUpdateRule,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useRuleDialog, useRuleText } from './rule-dialog';

export function RulesSettings() {
  const { data: rules, isPending } = useRules();
  const { openRule } = useRuleDialog();
  const canWrite = useCanWrite();

  if (isPending || !rules) return <Skeleton className="h-96" />;

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Rules clean up imported transactions: rename “FONEPAY/QR/PATHAO” to Pathao, pick the
          category, add tags. They run from top to bottom, and a later rule wins when two set the
          same thing.
        </p>
        {canWrite && (
          <Button size="sm" onClick={() => openRule()}>
            <Plus /> New rule
          </Button>
        )}
      </div>
      {rules.length === 0 ? (
        <Card>
          <EmptyState
            as="h2"
            icon={Wand2}
            title="No rules yet"
            description="Create one here, or categorize a transaction in the review inbox and choose “Always do this”."
          />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {rules.map((rule, i) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              index={i}
              ids={rules.map((r) => r.id)}
              canWrite={canWrite}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  index,
  ids,
  canWrite,
}: {
  rule: Rule;
  index: number;
  ids: string[];
  canWrite: boolean;
}) {
  const f = useFormat();
  const text = useRuleText();
  const { openRule } = useRuleDialog();
  const update = useUpdateRule();
  const reorder = useReorderRules();
  const apply = useApplyRule();
  const remove = useDeleteRule();
  const confirm = useConfirm();

  const move = (delta: number) => {
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    reorder.mutate(next, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const summary = rule.conditions.map(text.condition).join(rule.match === 'all' ? ' and ' : ' or ');

  return (
    <div className={cn('flex items-start gap-3 px-4 py-3', !rule.enabled && 'opacity-60')}>
      <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-medium text-muted-foreground tabular">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full truncate text-left text-sm font-medium hover:underline disabled:hover:no-underline"
          onClick={() => openRule(rule)}
          disabled={!canWrite}
        >
          {rule.name}
        </button>
        {summary !== rule.name && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <ListFilter className="mr-1 inline size-3 align-[-1px]" />
            {summary}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rule.actions.map((a) => (
            <Badge key={a.type} tone="primary">
              {text.action(a)}
            </Badge>
          ))}
          {rule.stopProcessing && <Badge>Stops here</Badge>}
        </div>
        <p className="mt-1.5 text-2xs text-muted-foreground">
          {rule.hitCount === 0
            ? 'Not used yet'
            : `Used on ${rule.hitCount} transaction${rule.hitCount === 1 ? '' : 's'}${
                rule.lastHitAt ? ` · ${f.relativeDate(rule.lastHitAt.slice(0, 10))}` : ''
              }`}
        </p>
      </div>
      {canWrite && (
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={rule.enabled}
            aria-label={`${rule.name} enabled`}
            onCheckedChange={(enabled) =>
              update.mutate(
                { id: rule.id, enabled },
                { onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`${rule.name} options`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openRule(rule)}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  const ok = await confirm({
                    title: `Run “${rule.name}” now?`,
                    description:
                      'It updates every existing transaction it matches, including ones that already have a category.',
                    confirmLabel: 'Run rule',
                  });
                  if (!ok) return;
                  apply.mutate(
                    { id: rule.id, onlyUncategorized: false },
                    {
                      onSuccess: ({ updated }) =>
                        toast.success(
                          updated === 0
                            ? 'Nothing needed changing'
                            : `Updated ${updated} transaction${updated === 1 ? '' : 's'}`,
                        ),
                      onError: (e) => toast.error(errorMessage(e)),
                    },
                  );
                }}
              >
                <Play /> Run on existing transactions
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => move(-1)}>
                <ArrowUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === ids.length - 1} onSelect={() => move(1)}>
                <ArrowDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  const ok = await confirm({
                    title: `Delete “${rule.name}”?`,
                    description: 'Transactions it already changed stay as they are.',
                    confirmLabel: 'Delete',
                    destructive: true,
                  });
                  if (ok) remove.mutate(rule.id, { onError: (e) => toast.error(errorMessage(e)) });
                }}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
