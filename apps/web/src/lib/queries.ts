import type {
  Account,
  BudgetMonth,
  BudgetVsActual,
  BulkTransactionAction,
  CashFlow,
  Category,
  CategoryGroup,
  CategoryTrends,
  CommitImportInput,
  CreateAccountInput,
  CreateCategoryInput,
  CreateTransactionInput,
  CreateTransferInput,
  CreateWorkspaceInput,
  Dashboard,
  ExchangeRate,
  ImportBatch,
  ImportMapping,
  ImportPreview,
  ImportProfile,
  ImportRow,
  ListTransactionsQuery,
  Me,
  Payee,
  Rule,
  RuleInput,
  RulePreview,
  SpendingByCategory,
  Tag,
  Transaction,
  TransactionPage,
  UpdateAccountInput,
  UpdateCategoryInput,
  UpdateMeInput,
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
import { api } from './api';
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
