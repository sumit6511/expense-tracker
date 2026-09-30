import {
  BudgetMonthSchema,
  BudgetVsActualSchema,
  CashFlowSchema,
  CategoryTrendsSchema,
  CopyBudgetsSchema,
  DashboardSchema,
  FillAverageBudgetsSchema,
  IsoDateSchema,
  ReportQuerySchema,
  SetBudgetsSchema,
  SpendingByCategorySchema,
  todayIn,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  NoContent,
  WidParams,
} from '../lib/openapi';
import { copyBudgets, fillAverageBudgets, getBudgetMonth, setBudgets } from '../services/budgets';
import {
  budgetVsActual,
  cashFlow,
  categoryTrends,
  dashboard,
  spendingByCategory,
} from '../services/reports';

/** Budgets and reports. */
export const budgetsRouter = createRouter();

const DateQuery = z.object({ date: IsoDateSchema.optional() });
const CountResult = jsonContent(z.object({ count: z.number() }));

budgetsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/budgets',
    tags: ['Budgets'],
    summary:
      'The budget month containing `date` (default today): budgeted, spent and remaining per category',
    request: { params: WidParams, query: DateQuery },
    responses: { 200: jsonContent(BudgetMonthSchema), ...errorResponses },
  }),
  async (c) => {
    const ws = c.get('workspace');
    const date = c.req.valid('query').date ?? todayIn(ws.timezone);
    return c.json(await getBudgetMonth(c.get('deps').db, ws, date), 200);
  },
);

budgetsRouter.openapi(
  createRoute({
    method: 'put',
    path: '/workspaces/{wid}/budgets',
    tags: ['Budgets'],
    summary: 'Set budget amounts for a month (0 removes a budget)',
    request: { params: WidParams, ...jsonBody(SetBudgetsSchema) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const { periodStart, items } = c.req.valid('json');
    await setBudgets(c.get('deps').db, c.get('workspace'), periodStart, items);
    return c.body(null, 204);
  },
);

budgetsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/budgets/copy',
    tags: ['Budgets'],
    summary: 'Copy budgets from one month to another',
    request: { params: WidParams, ...jsonBody(CopyBudgetsSchema) },
    responses: { 200: CountResult, ...errorResponses },
  }),
  async (c) => {
    const { fromPeriodStart, toPeriodStart, overwrite } = c.req.valid('json');
    const count = await copyBudgets(
      c.get('deps').db,
      c.get('workspace'),
      fromPeriodStart,
      toPeriodStart,
      overwrite,
    );
    return c.json({ count }, 200);
  },
);

budgetsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/budgets/fill-average',
    tags: ['Budgets'],
    summary: 'Set budgets to average spending over the previous months',
    request: { params: WidParams, ...jsonBody(FillAverageBudgetsSchema) },
    responses: { 200: CountResult, ...errorResponses },
  }),
  async (c) => {
    const { periodStart, months, overwrite } = c.req.valid('json');
    const count = await fillAverageBudgets(
      c.get('deps').db,
      c.get('workspace'),
      periodStart,
      months,
      overwrite,
    );
    return c.json({ count }, 200);
  },
);

// Reports --------------------------------------------------------------------------------------

budgetsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/reports/dashboard',
    tags: ['Reports'],
    summary: 'Home screen summary for the budget month containing `date`',
    request: { params: WidParams, query: DateQuery },
    responses: { 200: jsonContent(DashboardSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await dashboard(c.get('deps').db, c.get('workspace'), c.req.valid('query').date), 200),
);

budgetsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/reports/spending-by-category',
    tags: ['Reports'],
    summary: 'Spending and income per category over a date range, in the base currency',
    request: { params: WidParams, query: ReportQuerySchema },
    responses: { 200: jsonContent(SpendingByCategorySchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await spendingByCategory(c.get('deps').db, c.get('workspace'), c.req.valid('query')),
      200,
    ),
);

budgetsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/reports/cash-flow',
    tags: ['Reports'],
    summary: 'Income, spending and net per budget month',
    request: { params: WidParams, query: ReportQuerySchema },
    responses: { 200: jsonContent(CashFlowSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await cashFlow(c.get('deps').db, c.get('workspace'), c.req.valid('query')), 200),
);

budgetsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/reports/category-trends',
    tags: ['Reports'],
    summary: 'Spending per category per budget month',
    request: { params: WidParams, query: ReportQuerySchema },
    responses: { 200: jsonContent(CategoryTrendsSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await categoryTrends(c.get('deps').db, c.get('workspace'), c.req.valid('query')), 200),
);

budgetsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/reports/budget-vs-actual',
    tags: ['Reports'],
    summary: 'Total budgeted vs spent for recent budget months',
    request: {
      params: WidParams,
      query: DateQuery.extend({ periods: z.coerce.number().int().min(1).max(24).default(6) }),
    },
    responses: { 200: jsonContent(BudgetVsActualSchema), ...errorResponses },
  }),
  async (c) => {
    const ws = c.get('workspace');
    const { date, periods } = c.req.valid('query');
    return c.json(
      await budgetVsActual(c.get('deps').db, ws, date ?? todayIn(ws.timezone), periods),
      200,
    );
  },
);
