import type {
  Account,
  Attachment,
  BudgetMonth,
  BudgetVsActual,
  BulkTransactionAction,
  CashFlow,
  Category,
  CategoryGroup,
  CategoryTrends,
  CommitImportInput,
  Comparison,
  CreateAccountInput,
  CreateCategoryInput,
  CreateInvitationInput,
  CreateSplitGroupInput,
  CreateTransactionInput,
  CreateTransferInput,
  CreateWorkspaceInput,
  DailySpending,
  Dashboard,
  ExchangeRate,
  FinishReconcileInput,
  Forecast,
  Goal,
  GoalInput,
  ImportBatch,
  ImportMapping,
  ImportPreview,
  ImportProfile,
  ImportRow,
  Insights,
  InvitationCreated,
  ListTransactionsQuery,
  MarkNotificationsRead,
  Me,
  Members,
  NetWorthSeries,
  NotificationList,
  NotificationSettings,
  Payee,
  ReconcileState,
  Reconciliation,
  RecordRecurringInput,
  Recurring,
  RecurringInput,
  RecurringSuggestion,
  Rule,
  RuleInput,
  RulePreview,
  SetBudgetCapInput,
  SetRolloverInput,
  SpendingByCategory,
  SpendingByGroup,
  SplitExpenseBody,
  SplitGroup,
  SplitGroupSummary,
  SplitSettlementBody,
  Tag,
  Transaction,
  TransactionChange,
  TransactionPage,
  UpcomingItem,
  UpdateAccountInput,
  UpdateCategoryInput,
  UpdateMeInput,
  UpdateNotificationPrefs,
  UpdateTransactionInput,
  UpdateWorkspaceInput,
  Workspace,
} from '@et/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, apiUpload } from './api';
import { useWorkspace } from './session';

// ---------------------------------------------------------------------------------------------
// Keys: everything for a workspace lives under ['ws', id] so one invalidation refreshes it all.
// ---------------------------------------------------------------------------------------------

export const meKey = ['me'] as const;
const wsKey = (wid: string) => ['ws', wid] as const;

function useWs() {
  const ws = useWorkspace();
  return { wid: ws.id, base: `/workspaces/${ws.id}` };
}

/** Invalidates all data of the current workspace (cheap at personal scale, and always right). */
export function useInvalidateWorkspace() {
  const qc = useQueryClient();
  const { wid } = useWs();
  return () => qc.invalidateQueries({ queryKey: wsKey(wid) });
}

function useWsMutation<TInput, TResult>(fn: (base: string, input: TInput) => Promise<TResult>) {
  const { base } = useWs();
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: (input: TInput) => fn(base, input),
    onSuccess: () => invalidate(),
  });
}

// ---------------------------------------------------------------------------------------------
// Me & workspaces
// ---------------------------------------------------------------------------------------------

export function useMeQuery(enabled = true) {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api<Me>('/me'),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api<Me>('/me', { method: 'PATCH', body: input }),
    onSuccess: (me) => qc.setQueryData(meKey, me),
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) =>
      api<Workspace>('/workspaces', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { backup: unknown; name?: string }) =>
      api<Workspace>('/workspaces/restore', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  const { base } = useWs();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) =>
      api<Workspace>(base, { method: 'PATCH', body: input }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      await qc.invalidateQueries({ queryKey: ['ws'] });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  const { base } = useWs();
  return useMutation({
    mutationFn: () => api<void>(base, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

// ---------------------------------------------------------------------------------------------
// Accounts, categories, payees, tags
// ---------------------------------------------------------------------------------------------

export function useAccounts() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'accounts'],
    queryFn: () => api<Account[]>(`${base}/accounts`),
  });
}

export function useAccountMap() {
  const { data } = useAccounts();
  return useMemo(() => new Map((data ?? []).map((a) => [a.id, a])), [data]);
}

export const useCreateAccount = () =>
  useWsMutation((base, input: CreateAccountInput) =>
    api<Account>(`${base}/accounts`, { method: 'POST', body: input }),
  );
export const useUpdateAccount = () =>
  useWsMutation((base, { id, ...input }: UpdateAccountInput & { id: string }) =>
    api<Account>(`${base}/accounts/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteAccount = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/accounts/${id}`, { method: 'DELETE' }));

export function useCategories() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'categories'],
    queryFn: () => api<CategoryGroup[]>(`${base}/categories`),
    staleTime: 60_000,
  });
}

export interface CategoryInfo extends Category {
  group: CategoryGroup;
}

/** Category id → category with its group (kind, name). */
export function useCategoryMap() {
  const { data } = useCategories();
  return useMemo(() => {
    const map = new Map<string, CategoryInfo>();
    for (const group of data ?? [])
      for (const c of group.categories) map.set(c.id, { ...c, group });
    return map;
  }, [data]);
}

export const useCreateCategoryGroup = () =>
  useWsMutation((base, input: { name: string; kind: 'expense' | 'income' }) =>
    api<{ id: string }>(`${base}/category-groups`, { method: 'POST', body: input }),
  );
export const useUpdateCategoryGroup = () =>
  useWsMutation(
    (
      base,
      { id, ...input }: { id: string; name?: string; archived?: boolean; sortOrder?: number },
    ) => api<void>(`${base}/category-groups/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteCategoryGroup = () =>
  useWsMutation((base, id: string) =>
    api<void>(`${base}/category-groups/${id}`, { method: 'DELETE' }),
  );
export const useCreateCategory = () =>
  useWsMutation((base, input: CreateCategoryInput) =>
    api<{ id: string }>(`${base}/categories`, { method: 'POST', body: input }),
  );
export const useUpdateCategory = () =>
  useWsMutation((base, { id, ...input }: UpdateCategoryInput & { id: string }) =>
    api<void>(`${base}/categories/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteCategory = () =>
  useWsMutation((base, { id, reassignTo }: { id: string; reassignTo?: string | 'none' }) =>
    api<void>(`${base}/categories/${id}`, { method: 'DELETE', query: { reassignTo } }),
  );

export function usePayees() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'payees'],
    queryFn: () => api<Payee[]>(`${base}/payees`),
    staleTime: 60_000,
  });
}

export const useUpdatePayee = () =>
  useWsMutation(
    (base, { id, ...input }: { id: string; name?: string; defaultCategoryId?: string | null }) =>
      api<{ id: string }>(`${base}/payees/${id}`, { method: 'PATCH', body: input }),
  );
export const useMergePayee = () =>
  useWsMutation((base, { id, targetId }: { id: string; targetId: string }) =>
    api<void>(`${base}/payees/${id}/merge`, { method: 'POST', body: { targetId } }),
  );
export const useDeletePayee = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/payees/${id}`, { method: 'DELETE' }));

export function useTags() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'tags'],
    queryFn: () => api<Tag[]>(`${base}/tags`),
    staleTime: 60_000,
  });
}

export const useCreateTag = () =>
  useWsMutation((base, input: { name: string; color?: string }) =>
    api<{ id: string }>(`${base}/tags`, { method: 'POST', body: input }),
  );
export const useUpdateTag = () =>
  useWsMutation((base, { id, ...input }: { id: string; name?: string; color?: string }) =>
    api<void>(`${base}/tags/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteTag = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/tags/${id}`, { method: 'DELETE' }));

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

export type TransactionFilters = Omit<ListTransactionsQuery, 'cursor' | 'limit'>;

export function useTransactions(filters: TransactionFilters, limit = 100) {
  const { wid, base } = useWs();
  return useInfiniteQuery({
    queryKey: [...wsKey(wid), 'transactions', filters, limit],
    queryFn: ({ pageParam }) =>
      api<TransactionPage>(`${base}/transactions`, {
        query: { ...(filters as Record<string, string>), limit, cursor: pageParam ?? undefined },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useTransaction(id: string | null) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'transaction', id],
    queryFn: () => api<Transaction>(`${base}/transactions/${id}`),
    enabled: id !== null,
  });
}

export const useCreateTransaction = () =>
  useWsMutation((base, input: CreateTransactionInput) =>
    api<Transaction>(`${base}/transactions`, { method: 'POST', body: input }),
  );
export const useUpdateTransaction = () =>
  useWsMutation((base, { id, ...input }: UpdateTransactionInput & { id: string }) =>
    api<Transaction>(`${base}/transactions/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteTransaction = () =>
  useWsMutation((base, id: string) =>
    api<void>(`${base}/transactions/${id}`, { method: 'DELETE' }),
  );
export const useRestoreTransaction = () =>
  useWsMutation((base, id: string) =>
    api<Transaction>(`${base}/transactions/${id}/restore`, { method: 'POST' }),
  );
export const useBulkTransactions = () =>
  useWsMutation((base, action: BulkTransactionAction) =>
    api<{ updated: number; skipped: number }>(`${base}/transactions/bulk`, {
      method: 'POST',
      body: action,
    }),
  );

export interface TransferResult {
  from: Transaction;
  to: Transaction;
}
export const useCreateTransfer = () =>
  useWsMutation((base, input: CreateTransferInput) =>
    api<TransferResult>(`${base}/transfers`, { method: 'POST', body: input }),
  );
export const useUpdateTransfer = () =>
  useWsMutation((base, { groupId, ...input }: Partial<CreateTransferInput> & { groupId: string }) =>
    api<TransferResult>(`${base}/transfers/${groupId}`, { method: 'PATCH', body: input }),
  );

// ---------------------------------------------------------------------------------------------
// Budgets & reports
// ---------------------------------------------------------------------------------------------

export function useBudgetMonth(date: string) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'budgets', date],
    queryFn: () => api<BudgetMonth>(`${base}/budgets`, { query: { date } }),
    placeholderData: keepPreviousData,
  });
}

export const useMoveBudget = () =>
  useWsMutation(
    (
      base,
      input: {
        periodStart: string;
        fromCategoryId: string | null;
        toCategoryId: string | null;
        amountMinor: number;
      },
    ) => api<void>(`${base}/budgets/move`, { method: 'POST', body: input }),
  );

export const useSetBudgets = () =>
  useWsMutation(
    (
      base,
      input: { periodStart: string; items: Array<{ categoryId: string; amountMinor: number }> },
    ) => api<void>(`${base}/budgets`, { method: 'PUT', body: input }),
  );
export const useCopyBudgets = () =>
  useWsMutation(
    (base, input: { fromPeriodStart: string; toPeriodStart: string; overwrite?: boolean }) =>
      api<{ count: number }>(`${base}/budgets/copy`, { method: 'POST', body: input }),
  );
export const useFillAverageBudgets = () =>
  useWsMutation((base, input: { periodStart: string; months?: number; overwrite?: boolean }) =>
    api<{ count: number }>(`${base}/budgets/fill-average`, { method: 'POST', body: input }),
  );

export function useDashboard(date?: string) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'dashboard', date ?? 'today'],
    queryFn: () => api<Dashboard>(`${base}/reports/dashboard`, { query: { date } }),
    placeholderData: keepPreviousData,
  });
}

export interface ReportRange {
  from: string;
  to: string;
  accountIds?: string[];
}

function useReport<T>(name: string, range: ReportRange) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'report', name, range],
    queryFn: () => api<T>(`${base}/reports/${name}`, { query: { ...range } }),
    placeholderData: keepPreviousData,
  });
}

export const useSpendingByCategory = (range: ReportRange) =>
  useReport<SpendingByCategory>('spending-by-category', range);
export const useCashFlow = (range: ReportRange) => useReport<CashFlow>('cash-flow', range);
export const useSpendingByPayee = (range: ReportRange) =>
  useReport<SpendingByGroup>('spending-by-payee', range);
export const useSpendingByTag = (range: ReportRange) =>
  useReport<SpendingByGroup>('spending-by-tag', range);
export const useNetWorthSeries = (range: ReportRange) =>
  useReport<NetWorthSeries>('net-worth', { from: range.from, to: range.to });
export const useDailySpending = (range: ReportRange) => useReport<DailySpending>('daily', range);
export function useComparison(range: ReportRange, compareFrom: string, compareTo: string) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'report', 'compare', range, compareFrom, compareTo],
    queryFn: () =>
      api<Comparison>(`${base}/reports/compare`, {
        query: { ...range, compareFrom, compareTo },
      }),
    placeholderData: keepPreviousData,
  });
}
export const useCategoryTrends = (range: ReportRange) =>
  useReport<CategoryTrends>('category-trends', range);

export function useBudgetVsActual(date: string, periods = 6) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'report', 'budget-vs-actual', date, periods],
    queryFn: () =>
      api<BudgetVsActual>(`${base}/reports/budget-vs-actual`, { query: { date, periods } }),
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------------------------
// Rates, imports
// ---------------------------------------------------------------------------------------------

export function useRates() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'rates'],
    queryFn: () => api<ExchangeRate[]>(`${base}/rates`),
  });
}

export const useSetManualRate = () =>
  useWsMutation((base, input: { base: string; quote: string; date: string; rate: string }) =>
    api<void>(`${base}/rates/manual`, { method: 'PUT', body: input }),
  );
export const useDeleteManualRate = () =>
  useWsMutation((base, input: { base: string; quote: string; date: string }) =>
    api<void>(`${base}/rates/manual`, { method: 'DELETE', query: input }),
  );

export function useImportBatches() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'imports'],
    queryFn: () => api<ImportBatch[]>(`${base}/imports`),
  });
}

export function useImportProfiles() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'import-profiles'],
    queryFn: () => api<ImportProfile[]>(`${base}/import-profiles`),
  });
}

export function usePreviewImport() {
  const { base } = useWs();
  return useMutation({
    mutationFn: (input: { accountId: string; rows: ImportRow[] }) =>
      api<ImportPreview>(`${base}/imports/preview`, { method: 'POST', body: input }),
  });
}

export const useCommitImport = () =>
  useWsMutation((base, input: CommitImportInput) =>
    api<ImportBatch>(`${base}/imports`, { method: 'POST', body: input }),
  );
export const useRevertImport = () =>
  useWsMutation((base, id: string) =>
    api<ImportBatch>(`${base}/imports/${id}/revert`, { method: 'POST' }),
  );
export const useCreateImportProfile = () =>
  useWsMutation((base, input: { name: string; mapping: ImportMapping }) =>
    api<{ id: string }>(`${base}/import-profiles`, { method: 'POST', body: input }),
  );
export const useDeleteImportProfile = () =>
  useWsMutation((base, id: string) =>
    api<void>(`${base}/import-profiles/${id}`, { method: 'DELETE' }),
  );

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export function useRules() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'rules'],
    queryFn: () => api<Rule[]>(`${base}/rules`),
  });
}

export const useCreateRule = () =>
  useWsMutation((base, input: RuleInput) =>
    api<Rule>(`${base}/rules`, { method: 'POST', body: input }),
  );
export const useUpdateRule = () =>
  useWsMutation((base, { id, ...input }: Partial<RuleInput> & { id: string }) =>
    api<Rule>(`${base}/rules/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteRule = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/rules/${id}`, { method: 'DELETE' }));
export const useReorderRules = () =>
  useWsMutation((base, ids: string[]) =>
    api<Rule[]>(`${base}/rules/reorder`, { method: 'POST', body: { ids } }),
  );
export const useApplyRule = () =>
  useWsMutation((base, { id, onlyUncategorized }: { id: string; onlyUncategorized: boolean }) =>
    api<{ updated: number }>(`${base}/rules/${id}/apply`, {
      method: 'POST',
      body: { onlyUncategorized },
    }),
  );

/** Which existing transactions a (possibly unsaved) rule matches. */
export function useRulePreview(rule: RuleInput | null, onlyUncategorized: boolean) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'rule-preview', JSON.stringify(rule), onlyUncategorized],
    queryFn: () =>
      api<RulePreview>(`${base}/rules/preview`, {
        method: 'POST',
        body: { rule, onlyUncategorized },
      }),
    enabled: rule !== null,
    placeholderData: keepPreviousData,
  });
}

/** How many transactions wait in the review inbox. */
export function useReviewCounts() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'review-counts'],
    queryFn: async () => {
      const [review, uncategorized] = await Promise.all([
        api<TransactionPage>(`${base}/transactions`, {
          query: { needsReview: 'true', limit: 1 },
        }),
        api<TransactionPage>(`${base}/transactions`, {
          query: { categoryIds: 'none', limit: 1 },
        }),
      ]);
      return { needsReview: review.totals.count, uncategorized: uncategorized.totals.count };
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------------------------
// Recurring
// ---------------------------------------------------------------------------------------------

export function useRecurring() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'recurring'],
    queryFn: () => api<Recurring[]>(`${base}/recurring`),
  });
}

export function useUpcoming(days = 30) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'recurring-upcoming', days],
    queryFn: () => api<UpcomingItem[]>(`${base}/recurring/upcoming`, { query: { days } }),
  });
}

export function useRecurringSuggestions() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'recurring-suggestions'],
    queryFn: () => api<RecurringSuggestion[]>(`${base}/recurring/suggestions`),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------------------------
// Insights & forecast
// ---------------------------------------------------------------------------------------------

export function useInsights() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'insights'],
    queryFn: () => api<Insights>(`${base}/insights`),
    staleTime: 5 * 60_000,
  });
}

/** Hides an insight (or a recurring suggestion) for you, straight away. */
export function useDismissInsight() {
  const { wid, base } = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      api<void>(`${base}/insights/dismiss`, { method: 'POST', body: { key } }),
    onMutate: (key) => {
      qc.setQueryData<Insights>([...wsKey(wid), 'insights'], (old) =>
        old ? { ...old, items: old.items.filter((i) => i.key !== key) } : old,
      );
      qc.setQueryData<RecurringSuggestion[]>([...wsKey(wid), 'recurring-suggestions'], (old) =>
        old?.filter((s) => s.dismissKey !== key),
      );
    },
  });
}

export function useForecast(days: number, accountIds?: string) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'forecast', days, accountIds ?? ''],
    queryFn: () =>
      api<Forecast>(`${base}/forecast`, {
        query: { days, ...(accountIds ? { accountIds } : {}) },
      }),
    placeholderData: keepPreviousData,
  });
}

export const useCreateRecurring = () =>
  useWsMutation((base, input: RecurringInput) =>
    api<Recurring>(`${base}/recurring`, { method: 'POST', body: input }),
  );
export const useUpdateRecurring = () =>
  useWsMutation((base, { id, ...input }: Partial<RecurringInput> & { id: string }) =>
    api<Recurring>(`${base}/recurring/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteRecurring = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/recurring/${id}`, { method: 'DELETE' }));
export const useRecordRecurring = () =>
  useWsMutation((base, { id, ...input }: RecordRecurringInput & { id: string }) =>
    api<{ transaction: Transaction; recurring: Recurring }>(`${base}/recurring/${id}/record`, {
      method: 'POST',
      body: input,
    }),
  );
export const useSkipRecurring = () =>
  useWsMutation((base, id: string) =>
    api<Recurring>(`${base}/recurring/${id}/skip`, { method: 'POST' }),
  );

// ---------------------------------------------------------------------------------------------
// Rollover, monthly limit, goals
// ---------------------------------------------------------------------------------------------

export const useSetRollover = () =>
  useWsMutation((base, input: SetRolloverInput) =>
    api<void>(`${base}/budgets/rollover`, { method: 'PUT', body: input }),
  );
export const useSetBudgetCap = () =>
  useWsMutation((base, input: SetBudgetCapInput) =>
    api<void>(`${base}/budgets/cap`, { method: 'PUT', body: input }),
  );

export function useGoals() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'goals'],
    queryFn: () => api<Goal[]>(`${base}/goals`),
  });
}
export const useCreateGoal = () =>
  useWsMutation((base, input: GoalInput) =>
    api<Goal>(`${base}/goals`, { method: 'POST', body: input }),
  );
export const useUpdateGoal = () =>
  useWsMutation((base, { id, ...input }: Partial<GoalInput> & { id: string }) =>
    api<Goal>(`${base}/goals/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteGoal = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/goals/${id}`, { method: 'DELETE' }));
export const useContributeGoal = () =>
  useWsMutation((base, { id, amountMinor }: { id: string; amountMinor: number }) =>
    api<Goal>(`${base}/goals/${id}/contribute`, { method: 'POST', body: { amountMinor } }),
  );

// ---------------------------------------------------------------------------------------------
// History, attachments, reconciliation
// ---------------------------------------------------------------------------------------------

export function useTransactionHistory(id: string | null) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'history', id],
    queryFn: () => api<TransactionChange[]>(`${base}/transactions/${id}/history`),
    enabled: id !== null,
  });
}

export function useAttachments(transactionId: string | null) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'attachments', transactionId],
    queryFn: () => api<Attachment[]>(`${base}/transactions/${transactionId}/attachments`),
    enabled: transactionId !== null,
  });
}

export const attachmentUrl = (wid: string, id: string) =>
  `/api/v1/workspaces/${wid}/attachments/${id}`;

export const useUploadAttachment = () =>
  useWsMutation(
    (base, { transactionId, file, name }: { transactionId: string; file: Blob; name: string }) =>
      apiUpload<Attachment>(`${base}/transactions/${transactionId}/attachments`, file, name),
  );
export const useDeleteAttachment = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/attachments/${id}`, { method: 'DELETE' }));

export function useReconcileState(accountId: string, statementDate: string, enabled = true) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'reconcile', accountId, statementDate],
    queryFn: () =>
      api<ReconcileState>(`${base}/accounts/${accountId}/reconcile`, {
        query: { statementDate },
      }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useReconciliations(accountId: string) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'reconciliations', accountId],
    queryFn: () => api<Reconciliation[]>(`${base}/accounts/${accountId}/reconciliations`),
  });
}

export const useFinishReconcile = () =>
  useWsMutation((base, { accountId, ...input }: FinishReconcileInput & { accountId: string }) =>
    api<Reconciliation>(`${base}/accounts/${accountId}/reconcile`, {
      method: 'POST',
      body: input,
    }),
  );

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

/** Your notifications in this workspace; the server checks for new ones on each fetch. */
export function useNotifications() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'notifications'],
    queryFn: () => api<NotificationList>(`${base}/notifications`),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useMarkNotificationsRead() {
  const { wid } = useWs();
  const qc = useQueryClient();
  const key = [...wsKey(wid), 'notifications'];
  return useMutation({
    mutationFn: (input: MarkNotificationsRead) =>
      api<{ updated: number }>('/me/notifications/read', { method: 'POST', body: input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NotificationList>(key);
      if (previous) {
        const items = previous.items.map((n) =>
          !input.ids || input.ids.includes(n.id) ? { ...n, read: true } : n,
        );
        const newlyRead = previous.items.filter(
          (n) => !n.read && (!input.ids || input.ids.includes(n.id)),
        ).length;
        qc.setQueryData<NotificationList>(key, {
          items,
          unreadCount: input.ids ? Math.max(0, previous.unreadCount - newlyRead) : 0,
        });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
  });
}

const notificationSettingsKey = ['notification-settings'] as const;

export function useNotificationSettings() {
  return useQuery({
    queryKey: notificationSettingsKey,
    queryFn: () => api<NotificationSettings>('/me/notification-settings'),
  });
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPrefs) =>
      api<NotificationSettings>('/me/notification-settings', { method: 'PATCH', body: input }),
    onSuccess: (settings) => qc.setQueryData(notificationSettingsKey, settings),
  });
}

// ---------------------------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------------------------

export function useMembers() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'members'],
    queryFn: () => api<Members>(`${base}/members`),
    staleTime: 5 * 60_000,
  });
}

/** Names of the people in this workspace by user id, when more than one person uses it. */
export function useMemberNames(): Map<string, string> | null {
  const { data } = useMembers();
  return useMemo(
    () =>
      data && data.members.length > 1 ? new Map(data.members.map((m) => [m.userId, m.name])) : null,
    [data],
  );
}

export const useInvite = () =>
  useWsMutation((base, input: CreateInvitationInput) =>
    api<InvitationCreated>(`${base}/invitations`, { method: 'POST', body: input }),
  );
export const useRenewInvitation = () =>
  useWsMutation((base, id: string) =>
    api<InvitationCreated>(`${base}/invitations/${id}/renew`, { method: 'POST' }),
  );
export const useRevokeInvitation = () =>
  useWsMutation((base, id: string) => api<void>(`${base}/invitations/${id}`, { method: 'DELETE' }));
export const useUpdateMember = () =>
  useWsMutation((base, { userId, role }: { userId: string; role: 'admin' | 'editor' | 'viewer' }) =>
    api<Members>(`${base}/members/${userId}`, { method: 'PATCH', body: { role } }),
  );
export const useRemoveMember = () =>
  useWsMutation((base, userId: string) =>
    api<void>(`${base}/members/${userId}`, { method: 'DELETE' }),
  );

/** Ownership changes the workspace's role, which lives on /me. */
export function useTransferOwnership() {
  const qc = useQueryClient();
  const { base } = useWs();
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: (userId: string) =>
      api<Members>(`${base}/transfer-ownership`, { method: 'POST', body: { userId } }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: meKey }), invalidate()]);
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Split groups
// ---------------------------------------------------------------------------------------------

export function useSplitGroups() {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'split-groups'],
    queryFn: () => api<SplitGroupSummary[]>(`${base}/split-groups`),
  });
}

export function useSplitGroup(id: string) {
  const { wid, base } = useWs();
  return useQuery({
    queryKey: [...wsKey(wid), 'split-group', id],
    queryFn: () => api<SplitGroup>(`${base}/split-groups/${id}`),
  });
}

/** Every change returns the whole group; show it right away, then refresh everything else. */
function useSplitMutation<TInput>(
  fn: (base: string, input: TInput) => Promise<SplitGroup | undefined>,
) {
  const { wid, base } = useWs();
  const qc = useQueryClient();
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: (input: TInput) => fn(base, input),
    onSuccess: async (group) => {
      if (group) qc.setQueryData([...wsKey(wid), 'split-group', group.id], group);
      await invalidate();
    },
  });
}

export const useCreateSplitGroup = () =>
  useSplitMutation((base, input: CreateSplitGroupInput) =>
    api<SplitGroup>(`${base}/split-groups`, { method: 'POST', body: input }),
  );
export const useUpdateSplitGroup = () =>
  useSplitMutation(
    (
      base,
      {
        id,
        ...input
      }: {
        id: string;
        name?: string;
        simplifyDebts?: boolean;
        categoryId?: string | null;
        archived?: boolean;
      },
    ) => api<SplitGroup>(`${base}/split-groups/${id}`, { method: 'PATCH', body: input }),
  );
export const useDeleteSplitGroup = () =>
  useSplitMutation((base, id: string) =>
    api<undefined>(`${base}/split-groups/${id}`, { method: 'DELETE' }),
  );
export const useAddSplitMember = () =>
  useSplitMutation(
    (base, { groupId, ...input }: { groupId: string; name: string; userId?: string | null }) =>
      api<SplitGroup>(`${base}/split-groups/${groupId}/members`, { method: 'POST', body: input }),
  );
export const useRemoveSplitMember = () =>
  useSplitMutation((base, { groupId, memberId }: { groupId: string; memberId: string }) =>
    api<SplitGroup>(`${base}/split-groups/${groupId}/members/${memberId}`, { method: 'DELETE' }),
  );
export const useSaveSplitExpense = () =>
  useSplitMutation(
    (
      base,
      { groupId, expenseId, ...body }: SplitExpenseBody & { groupId: string; expenseId?: string },
    ) =>
      expenseId
        ? api<SplitGroup>(`${base}/split-groups/${groupId}/expenses/${expenseId}`, {
            method: 'PUT',
            body,
          })
        : api<SplitGroup>(`${base}/split-groups/${groupId}/expenses`, { method: 'POST', body }),
  );
export const useDeleteSplitExpense = () =>
  useSplitMutation((base, { groupId, expenseId }: { groupId: string; expenseId: string }) =>
    api<SplitGroup>(`${base}/split-groups/${groupId}/expenses/${expenseId}`, {
      method: 'DELETE',
    }),
  );
export const useCreateSettlement = () =>
  useSplitMutation((base, { groupId, ...body }: SplitSettlementBody & { groupId: string }) =>
    api<SplitGroup>(`${base}/split-groups/${groupId}/settlements`, { method: 'POST', body }),
  );
export const useDeleteSettlement = () =>
  useSplitMutation((base, { groupId, id }: { groupId: string; id: string }) =>
    api<SplitGroup>(`${base}/split-groups/${groupId}/settlements/${id}`, { method: 'DELETE' }),
  );
