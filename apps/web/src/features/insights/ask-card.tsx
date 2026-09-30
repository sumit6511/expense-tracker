import type { AskAnswer } from '@et/shared';
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useAiStatus, useAskMoney } from '@/lib/queries';

const EXAMPLES = [
  'How much did we spend eating out this month?',
  'What were our biggest expenses last month?',
  'How much is in our accounts right now?',
];

/** "Ask your money": answered by AI from the report API, never from raw data. */
export function AskCard() {
  const status = useAiStatus();
  const ask = useAskMoney();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<{ question: string; answer: AskAnswer } | null>(null);
  if (!status.data?.enabled) return null;

  async function submit(e: FormEvent, q = question) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setQuestion(q);
    try {
      setResult({ question: q, answer: await ask.mutateAsync(q.trim()) });
    } catch {
      setResult(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircleQuestion className="size-4 text-primary" /> Ask your money
        </CardTitle>
        <span className="text-xs text-muted-foreground">Answered by {status.data.provider}</span>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How much did we spend on groceries this year?"
            aria-label="Your question"
            maxLength={500}
          />
          <Button type="submit" disabled={ask.isPending || question.trim().length < 3}>
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Send />} Ask
          </Button>
        </form>
        {!result && !ask.isPending && !ask.error && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={(e) => void submit(e, q)}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {ask.isPending && (
          <p className="text-sm text-muted-foreground">Looking through your reports…</p>
        )}
        {ask.error && (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage(ask.error)}
          </p>
        )}
        {result && !ask.isPending && (
          <div className="rounded-lg bg-muted/60 px-4 py-3" aria-live="polite">
            <p className="text-xs text-muted-foreground">{result.question}</p>
            <p className="mt-1 text-sm whitespace-pre-line">{result.answer.answer}</p>
            {result.answer.sources.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                From: {result.answer.sources.join(', ')}. AI can make mistakes; the reports have the
                exact figures.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
