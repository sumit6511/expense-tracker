import {
  DATE_FORMAT_LABELS,
  DATE_FORMATS,
  type DateFormat,
  guessMapping,
  type ImportBatch,
  type ImportMapping,
  type ImportPreview,
  type NormalizedRow,
  normalizeRows,
  type ParsedStatement,
  parseBankSms,
  parseStatementFile,
  toIsoDate,
} from '@et/shared';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  FileSpreadsheet,
  Loader2,
  MessageSquareText,
  Save,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react';
import { type DragEvent, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page';
import { CategoryPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Segmented } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccountMap,
  useAccounts,
  useCommitImport,
  useCreateImportProfile,
  useImportBatches,
  useImportProfiles,
  usePreviewImport,
  useRevertImport,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';

type Step = 'upload' | 'map' | 'review' | 'done';

type Source = 'csv' | 'xlsx' | 'ofx' | 'qif' | 'camt' | 'sms';

interface ParsedFile {
  name: string;
  source: Source;
  /** Table cells, for CSV and Excel (mapped to fields in the next step). */
  rows: string[][];
  /** Rows already read from a structured format (OFX, QIF, CAMT, SMS): no mapping needed. */
  structured?: Pick<ParsedStatement, 'rows' | 'errors' | 'currency' | 'balance'>;
}

const FORMAT_NAMES: Record<Source, string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  ofx: 'OFX',
  qif: 'QIF',
  camt: 'CAMT.053',
  sms: 'SMS',
};

async function parseFile(file: File, digits: number): Promise<ParsedFile> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    const rows = data.map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (cell instanceof Date) {
          return toIsoDate({
            year: cell.getUTCFullYear(),
            month: cell.getUTCMonth() + 1,
            day: cell.getUTCDate(),
          });
        }
        return String(cell);
      }),
    );
    return { name: file.name, source: 'xlsx', rows };
  }
  if (lower.endsWith('.xls')) {
    throw new Error(
      'Old .xls files aren’t supported. Open the file in Excel or Google Sheets and save it as .xlsx or .csv.',
    );
  }
  const text = await file.text();
  const statement = parseStatementFile(text, digits, file.name);
  if (statement) {
    if (statement.rows.length === 0)
      throw new Error(`No transactions found in this ${FORMAT_NAMES[statement.format]} file.`);
    return { name: file.name, source: statement.format, rows: [], structured: statement };
  }
  const Papa = (await import('papaparse')).default;
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  if (result.data.length === 0) throw new Error('The file looks empty.');
  return {
    name: file.name,
    source: 'csv',
    rows: result.data.map((r) => r.map((c) => String(c ?? ''))),
  };
}

/** Column choice: -1 means "not in the file". */
function ColumnSelect({
  label,
  value,
  onChange,
  headers,
  optional,
  id,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  headers: string[];
  optional?: boolean;
  id: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <NativeSelect
        id={id}
        value={value === null || value === undefined ? '-1' : String(value)}
        onChange={(e) => onChange(e.target.value === '-1' ? null : Number(e.target.value))}
      >
        {optional && <option value="-1">— Not in file —</option>}
        {!optional && (value === null || value === undefined) && (
          <option value="-1">Choose column</option>
        )}
        {headers.map((h, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

export function ImportPage() {
  const f = useFormat();
  const canWrite = useCanWrite();
  const { data: accounts = [] } = useAccounts();
  const accountMap = useAccountMap();
  const profiles = useImportProfiles();
  const saveProfile = useCreateImportProfile();
  const preview = usePreviewImport();
  const commit = useCommitImport();
  const [step, setStep] = useState<Step>('upload');
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Partial<ImportMapping>>({});
  const [review, setReview] = useState<{ rows: NormalizedRow[]; preview: ImportPreview } | null>(
    null,
  );
  const [include, setInclude] = useState<boolean[]>([]);
  const [categories, setCategories] = useState<(string | null)[]>([]);
  const [result, setResult] = useState<ImportBatch | null>(null);
  const [dragging, setDragging] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [mode, setMode] = useState<'file' | 'sms'>('file');
  const [smsText, setSmsText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const account = accountMap.get(accountId);
  const currency = account?.currency ?? f.base;
  const digits = f.digits(currency);
  const activeAccounts = accounts.filter((a) => !a.archived);

  const headers = useMemo(() => {
    if (!file) return [];
    const width = Math.max(...file.rows.slice(0, 20).map((r) => r.length));
    return Array.from({ length: width }, (_, i) =>
      mapping.hasHeader && file.rows[0]?.[i]?.trim() ? file.rows[0][i]!.trim() : `Column ${i + 1}`,
    );
  }, [file, mapping.hasHeader]);

  const complete =
    mapping.date !== undefined && mapping.dateFormat !== undefined && mapping.amount !== undefined;
  const normalized = useMemo(
    () => (file && complete ? normalizeRows(file.rows, mapping as ImportMapping, digits) : null),
    [file, mapping, complete, digits],
  );

  async function onFile(selected: File | undefined) {
    if (!selected) return;
    try {
      const parsed = await parseFile(selected, digits);
      setFile(parsed);
      if (parsed.structured) {
        await startReview(parsed.structured.rows);
        return;
      }
      const guess = guessMapping(parsed.rows);
      setMapping({ hasHeader: true, ...guess });
      setStep('map');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function onSms() {
    const { rows, unreadable } = parseBankSms(smsText, { today: f.today, digits });
    if (rows.length === 0) {
      toast.error('No transactions found. Paste the alert messages exactly as you received them.');
      return;
    }
    if (unreadable.length)
      toast.warning(
        `${unreadable.length} message${unreadable.length === 1 ? '' : 's'} didn’t look like a transaction and ${unreadable.length === 1 ? 'was' : 'were'} skipped.`,
      );
    const parsed: ParsedFile = {
      name: 'SMS alerts',
      source: 'sms',
      rows: [],
      structured: { rows, errors: [], currency: null, balance: null },
    };
    setFile(parsed);
    await startReview(rows);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files[0]);
  }

  async function goReview() {
    if (!normalized || normalized.rows.length === 0) return;
    await startReview(normalized.rows);
  }

  async function startReview(source: NormalizedRow[]) {
    if (!accountId) return;
    try {
      const rows = source.map((r) => ({
        date: r.date,
        amountMinor: r.amountMinor,
        payee: r.payee,
        description: r.description,
        notes: r.notes,
        externalId: r.externalId,
      }));
      const res = await preview.mutateAsync({ accountId, rows });
      setReview({ rows: source, preview: res });
      setInclude(res.rows.map((r) => r.duplicateOfId === null));
      setCategories(res.rows.map((r) => r.suggestedCategoryId));
      setStep('review');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function doImport() {
    if (!review || !file) return;
    try {
      const batch = await commit.mutateAsync({
        accountId,
        fileName: file.name,
        source: file.source,
        ...(file.structured ? {} : { mapping: mapping as ImportMapping }),
        rows: review.rows.map((r, i) => ({
          date: r.date,
          amountMinor: r.amountMinor,
          payee: r.payee,
          description: r.description,
          notes: r.notes,
          externalId: r.externalId,
          categoryId: categories[i] ?? null,
          skip: !include[i],
        })),
      });
      setResult(batch);
      setStep('done');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function reset() {
    setStep('upload');
    setFile(null);
    setMapping({});
    setReview(null);
    setResult(null);
  }

  const steps: Array<[Step, string]> = [
    ['upload', 'Upload'],
    ['map', 'Match columns'],
    ['review', 'Review'],
    ['done', 'Done'],
  ];
  const stepIndex = steps.findIndex(([s]) => s === step);

  return (
    <div className="pb-10">
      <PageHeader
        title="Import a statement"
        description="Bring in transactions from your bank, card or wallet (eSewa, Khalti…): a statement file, or the alert SMS messages you received."
      />
      <ol className="mb-5 flex gap-2" aria-label="Import steps">
        {steps.map(([s, label], i) => (
          <li key={s} className="flex-1">
            <div className={cn('h-1.5 rounded-full', i <= stepIndex ? 'bg-primary' : 'bg-muted')} />
            <span
              className={cn(
                'mt-1.5 block text-xs',
                i === stepIndex ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      {!canWrite && (
        <p className="text-sm text-muted-foreground">
          You have read-only access to this workspace.
        </p>
      )}

      {canWrite && step === 'upload' && (
        <Card>
          <CardContent className="grid grid-cols-1 gap-5 pt-5">
            <Field label="Import into account" htmlFor="imp-account">
              <NativeSelect
                id="imp-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Choose account</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Segmented
              label="Import from"
              className="w-full sm:w-auto sm:justify-self-start"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'file', label: 'Statement file' },
                { value: 'sms', label: 'Paste SMS alerts' },
              ]}
            />
            {mode === 'sms' ? (
              <div className="grid grid-cols-1 gap-3">
                <Field
                  label="Alert messages"
                  htmlFor="imp-sms"
                  hint="Copy the debit/credit alerts from your bank or wallet and paste them here, separated by blank lines. They’re read on your device."
                >
                  <Textarea
                    id="imp-sms"
                    value={smsText}
                    onChange={(e) => setSmsText(e.target.value)}
                    rows={8}
                    placeholder={
                      'Dear Customer, your A/C 01XXXX456 has been debited by NPR 2,500.00 on 15/09/2026. Remarks: POS/BHAT BHATENI…\n\nYou have paid Rs. 250 to Momo Hut via Khalti. Txn ID: …'
                    }
                  />
                </Field>
                <Button
                  className="justify-self-start"
                  onClick={onSms}
                  disabled={!accountId || !smsText.trim() || preview.isPending}
                >
                  {preview.isPending ? <Loader2 className="animate-spin" /> : <MessageSquareText />}{' '}
                  {accountId ? 'Read messages' : 'Choose an account first'}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!accountId}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  dragging ? 'border-primary bg-accent' : 'hover:bg-muted/50',
                )}
              >
                <FileSpreadsheet className="size-8 text-primary" />
                <span className="font-medium">
                  {accountId ? 'Drop a file here, or click to choose' : 'Choose an account first'}
                </span>
                <span className="text-sm text-muted-foreground">
                  Excel, CSV, OFX/QFX, QIF or CAMT.053 · the file is read on your device
                </span>
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.ofx,.qfx,.qif,.xml,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/x-ofx,application/xml,text/xml"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <p className="text-xs text-muted-foreground">
              Tip: in internet banking, download your statement as Excel. Dates in Bikram Sambat
              (e.g. 2083-06-14) are recognised automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {canWrite && step === 'map' && file && (
        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {file.name} · {file.rows.length} rows
              </CardTitle>
              {(profiles.data?.length ?? 0) > 0 && (
                <NativeSelect
                  className="h-8 w-48 text-[13px]"
                  defaultValue=""
                  aria-label="Apply saved mapping"
                  onChange={(e) => {
                    const p = profiles.data?.find((x) => x.id === e.target.value);
                    if (p) setMapping(p.mapping);
                  }}
                >
                  <option value="">Apply saved mapping…</option>
                  {profiles.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={mapping.hasHeader ?? true}
                  onCheckedChange={(v) => setMapping((m) => ({ ...m, hasHeader: v === true }))}
                />
                First row contains column names
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ColumnSelect
                  id="map-date"
                  label="Date"
                  headers={headers}
                  value={mapping.date}
                  onChange={(v) => setMapping((m) => ({ ...m, date: v ?? undefined }))}
                />
                <Field label="Date format" htmlFor="map-date-format">
                  <NativeSelect
                    id="map-date-format"
                    value={mapping.dateFormat ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, dateFormat: e.target.value as DateFormat }))
                    }
                  >
                    {!mapping.dateFormat && <option value="">Choose format</option>}
                    {DATE_FORMATS.map((d) => (
                      <option key={d} value={d}>
                        {DATE_FORMAT_LABELS[d]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field label="Amounts">
                <Segmented
                  value={mapping.amount?.kind ?? 'single'}
                  onChange={(kind) =>
                    setMapping((m) => ({
                      ...m,
                      amount:
                        kind === 'single'
                          ? {
                              kind: 'single',
                              column: m.amount?.kind === 'single' ? m.amount.column : 0,
                            }
                          : {
                              kind: 'debitCredit',
                              debit: m.amount?.kind === 'debitCredit' ? m.amount.debit : 0,
                              credit: m.amount?.kind === 'debitCredit' ? m.amount.credit : 1,
                            },
                    }))
                  }
                  options={[
                    { value: 'single', label: 'One amount column' },
                    { value: 'debitCredit', label: 'Withdrawal & deposit columns' },
                  ]}
                />
              </Field>
              {mapping.amount?.kind === 'debitCredit' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ColumnSelect
                    id="map-debit"
                    label="Withdrawal / debit (money out)"
                    headers={headers}
                    value={mapping.amount.debit}
                    onChange={(v) =>
                      setMapping((m) => ({
                        ...m,
                        amount: {
                          ...(m.amount as { kind: 'debitCredit'; debit: number; credit: number }),
                          debit: v ?? 0,
                        },
                      }))
                    }
                  />
                  <ColumnSelect
                    id="map-credit"
                    label="Deposit / credit (money in)"
                    headers={headers}
                    value={mapping.amount.credit}
                    onChange={(v) =>
                      setMapping((m) => ({
                        ...m,
                        amount: {
                          ...(m.amount as { kind: 'debitCredit'; debit: number; credit: number }),
                          credit: v ?? 0,
                        },
                      }))
                    }
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ColumnSelect
                    id="map-amount"
                    label="Amount"
                    headers={headers}
                    value={mapping.amount?.kind === 'single' ? mapping.amount.column : undefined}
                    onChange={(v) =>
                      setMapping((m) => ({
                        ...m,
                        amount: {
                          kind: 'single',
                          column: v ?? 0,
                          negate: m.amount?.kind === 'single' ? m.amount.negate : false,
                        },
                      }))
                    }
                  />
                  <label className="flex items-end gap-2 pb-2.5 text-sm">
                    <Checkbox
                      checked={mapping.amount?.kind === 'single' && mapping.amount.negate === true}
                      onCheckedChange={(v) =>
                        setMapping((m) => ({
                          ...m,
                          amount: {
                            kind: 'single',
                            column: m.amount?.kind === 'single' ? m.amount.column : 0,
                            negate: v === true,
                          },
                        }))
                      }
                    />
                    Spending is shown as positive numbers
                  </label>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ColumnSelect
                  id="map-desc"
                  label="Description / remarks"
                  optional
                  headers={headers}
                  value={mapping.description}
                  onChange={(v) => setMapping((m) => ({ ...m, description: v }))}
                />
                <ColumnSelect
                  id="map-payee"
                  label="Payee (if separate)"
                  optional
                  headers={headers}
                  value={mapping.payee}
                  onChange={(v) => setMapping((m) => ({ ...m, payee: v }))}
                />
                <ColumnSelect
                  id="map-ref"
                  label="Reference / cheque no."
                  optional
                  headers={headers}
                  value={mapping.externalId}
                  onChange={(v) => setMapping((m) => ({ ...m, externalId: v }))}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              {normalized && (
                <span className="text-xs text-muted-foreground">
                  {normalized.rows.length} readable · {normalized.errors.length} skipped
                </span>
              )}
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Payee</th>
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {normalized?.rows.slice(0, 8).map((r) => (
                    <tr key={r.line}>
                      <td className="px-3 py-2 whitespace-nowrap">{f.date(r.date)}</td>
                      <td className="max-w-40 truncate px-3 py-2">{r.payee}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                        {r.description}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money minor={r.amountMinor} currency={currency} signed colored />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!normalized && (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Choose the date and amount columns to see a preview.
                </p>
              )}
              {normalized && normalized.errors.length > 0 && (
                <details className="border-t px-4 py-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Rows that will be skipped ({normalized.errors.length})
                  </summary>
                  <ul className="mt-2 grid grid-cols-1 gap-1">
                    {normalized.errors.slice(0, 20).map((e) => (
                      <li key={e.line}>
                        Row {e.line + 1}: {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={reset}>
              <ArrowLeft /> Start over
            </Button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Name this format (e.g. Nabil Bank)"
                className="h-9 w-56"
                aria-label="Mapping name"
              />
              <Button
                variant="outline"
                disabled={!complete || !profileName.trim() || saveProfile.isPending}
                onClick={() =>
                  saveProfile.mutate(
                    { name: profileName.trim(), mapping: mapping as ImportMapping },
                    {
                      onSuccess: () => {
                        toast.success('Mapping saved for next time');
                        setProfileName('');
                      },
                      onError: (e) => toast.error(errorMessage(e)),
                    },
                  )
                }
              >
                <Save /> Save mapping
              </Button>
              <Button
                onClick={goReview}
                disabled={!normalized || normalized.rows.length === 0 || preview.isPending}
              >
                {preview.isPending && <Loader2 className="animate-spin" />} Review{' '}
                {normalized?.rows.length ?? 0} rows <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      )}

      {canWrite && step === 'review' && review && (
        <div className="grid grid-cols-1 gap-4">
          {file?.structured?.currency && file.structured.currency !== currency && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm" role="alert">
              This statement is in {file.structured.currency}, but {account?.name} is in {currency}.
              Check you picked the right account.
            </p>
          )}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>
                {include.filter(Boolean).length} of {review.rows.length} will be imported into{' '}
                {account?.name}
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {review.preview.rows.filter((r) => r.duplicateOfId).length} look like transactions
                you already have
                {file?.structured?.balance &&
                  ` · statement closing balance ${f.money(file.structured.balance.amountMinor, currency)}`}
              </span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        checked={
                          include.every(Boolean)
                            ? true
                            : include.some(Boolean)
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(v) => setInclude(include.map(() => v === true))}
                        aria-label="Include all"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Payee</th>
                    <th className="px-3 py-2 text-left font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {review.rows.map((r, i) => {
                    const p = review.preview.rows[i]!;
                    return (
                      <tr key={r.line} className={cn(!include[i] && 'opacity-50')}>
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={include[i]}
                            onCheckedChange={(v) =>
                              setInclude((list) => list.map((x, j) => (j === i ? v === true : x)))
                            }
                            aria-label={`Include ${r.payee || r.description}`}
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{f.date(r.date)}</td>
                        <td className="max-w-56 px-3 py-2">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate">{p.rulePayee ?? (r.payee || '—')}</span>
                            {p.ruleIds.length > 0 && (
                              <Badge tone="primary" title="Changed by your rules">
                                <Wand2 className="size-3" /> Rule
                              </Badge>
                            )}
                          </span>
                          {p.rulePayee && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {r.payee || r.description}
                            </span>
                          )}
                          {p.duplicateOfId && <Badge tone="warning">Already recorded?</Badge>}
                        </td>
                        <td className="w-52 min-w-44 px-3 py-1.5">
                          <CategoryPicker
                            value={categories[i] ?? null}
                            onChange={(id) =>
                              setCategories((list) => list.map((x, j) => (j === i ? id : x)))
                            }
                            kind={r.amountMinor < 0 ? 'expense' : 'income'}
                            className="h-8 text-[13px]"
                            placeholder={p.splitByRule ? 'Split by rule' : 'Choose category'}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Money minor={r.amountMinor} currency={currency} signed colored />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep('map')}>
              <ArrowLeft /> Back
            </Button>
            <Button onClick={doImport} disabled={commit.isPending || include.every((x) => !x)}>
              {commit.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Import{' '}
              {include.filter(Boolean).length} transactions
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CircleCheck className="size-10 text-positive" />
            <h2 className="text-lg font-semibold">Imported {result.created} transactions</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {result.skipped > 0 ? `${result.skipped} skipped. ` : ''}They wait in the review inbox
              so you can check categories quickly (unless a rule already confirmed them).
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/inbox">Open review inbox</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/transactions" search={{ importBatchId: result.id }}>
                  Review them
                </Link>
              </Button>
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <RecentImports />
    </div>
  );
}

function RecentImports() {
  const f = useFormat();
  const batches = useImportBatches();
  const accounts = useAccountMap();
  const revert = useRevertImport();
  const confirm = useConfirm();
  const canWrite = useCanWrite();
  const list = batches.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-sm font-semibold">Recent imports</h2>
      <Card className="divide-y overflow-hidden">
        {list.slice(0, 10).map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <FileSpreadsheet className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{b.fileName}</span>
              <span className="block text-xs text-muted-foreground">
                {accounts.get(b.accountId)?.name} · {f.relativeDate(b.createdAt.slice(0, 10))} ·{' '}
                {b.created} added
                {b.skipped ? `, ${b.skipped} skipped` : ''}
              </span>
            </span>
            {b.revertedAt ? (
              <Badge>Undone</Badge>
            ) : (
              canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Undo this import?',
                      description: `The ${b.created} transactions it added move to the trash.`,
                      confirmLabel: 'Undo import',
                      destructive: true,
                    });
                    if (!ok) return;
                    revert.mutate(b.id, {
                      onSuccess: () => toast.success('Import undone'),
                      onError: (e) => toast.error(errorMessage(e)),
                    });
                  }}
                >
                  <Undo2 /> Undo
                </Button>
              )
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}
