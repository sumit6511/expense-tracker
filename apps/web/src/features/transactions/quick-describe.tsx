import { currencyDigits, parseQuickText, type TransactionDraft } from '@et/shared';
import { Camera, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import {
  useAccounts,
  useAiStatus,
  useCategories,
  useParseText,
  useScanReceipt,
} from '@/lib/queries';

/** Receipt photos are scaled down before upload: enough to read, cheaper to send. */
async function shrink(file: File, maxSide = 1600): Promise<Blob> {
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/**
 * "Lunch 450 at Bhojan Griha yesterday via eSewa" → the form filled in. Rules first (they work
 * offline too); the server asks AI only when they can't read it and the workspace allows it.
 * With AI on, a camera button reads a receipt.
 */
export function QuickDescribe({
  accountId,
  onDraft,
  onReceipt,
}: {
  accountId: string;
  onDraft: (draft: TransactionDraft) => void;
  /** The scanned file, to attach to the transaction. */
  onReceipt: (file: File) => void;
}) {
  const f = useFormat();
  const t = useT();
  const [text, setText] = useState('');
  const parse = useParseText();
  const scan = useScanReceipt();
  const ai = useAiStatus();
  const { data: accounts = [] } = useAccounts();
  const { data: groups = [] } = useCategories();
  const fileInput = useRef<HTMLInputElement>(null);
  const aiOn = ai.data?.enabled ?? false;

  /** The same rules the server uses, for when it can't be reached. */
  function parseHere(): TransactionDraft {
    const currency = accounts.find((a) => a.id === accountId)?.currency ?? f.base;
    const result = parseQuickText(text, {
      today: f.today,
      digits: currencyDigits(currency),
      accounts: accounts.filter((a) => !a.archived),
      categories: groups.flatMap((g) =>
        g.categories.map((c) => ({ id: c.id, name: c.name, kind: g.kind })),
      ),
    });
    return { ...result, currency, source: 'rules' };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!text.trim()) return;
    let draft: TransactionDraft;
    try {
      draft = await parse.mutateAsync({ text, accountId: accountId || null });
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408) {
        toast.error(errorMessage(err));
        return;
      }
      draft = parseHere();
    }
    if (draft.amountMinor === null && !draft.payee && !draft.categoryId) {
      toast.error(
        aiOn
          ? 'Couldn’t make sense of that. Try “lunch 450 at Bhojan Griha”.'
          : 'Couldn’t find an amount. Try “lunch 450 at Bhojan Griha”.',
      );
      return;
    }
    onDraft(draft);
    setText('');
    if (draft.source === 'ai') toast('Filled in with AI help. Check it before saving.');
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const body = await shrink(file);
      const draft = await scan.mutateAsync(body);
      onDraft(draft);
      onReceipt(file);
      toast.success(
        draft.amountMinor === null
          ? 'Couldn’t find a total. The receipt is attached; fill in the rest.'
          : 'Receipt read. Check the details before saving.',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    // Its own little form inside the dialog's: Enter here fills the fields, it doesn't save.
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Wand2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(e);
          }}
          placeholder={t('Describe it: lunch 450 at Bhojan Griha yesterday')}
          aria-label={t('Describe the transaction')}
          className="pl-9"
          maxLength={300}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={(e) => void submit(e)}
        disabled={parse.isPending || !text.trim()}
        aria-label={t('Fill in')}
      >
        {parse.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
        <span className="hidden sm:inline">{t('Fill in')}</span>
      </Button>
      {aiOn && (
        <>
          <Tooltip content={t('Scan a receipt')}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('Scan a receipt')}
              disabled={scan.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {scan.isPending ? <Loader2 className="animate-spin" /> : <Camera />}
            </Button>
          </Tooltip>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </>
      )}
    </div>
  );
}
