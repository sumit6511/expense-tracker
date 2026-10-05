import { Link } from '@tanstack/react-router';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCanWrite } from '@/lib/session';
import { useTransactionDialog } from './transaction-dialog';

/** The two ways to get started with an empty workspace: add a transaction, or import a statement. */
export function AddOrImport() {
  const canWrite = useCanWrite();
  const { openNew } = useTransactionDialog();
  if (!canWrite) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button onClick={() => openNew()}>
        <Plus /> Add transaction
      </Button>
      <Button variant="outline" asChild>
        <Link to="/import">
          <Upload /> Import statement
        </Link>
      </Button>
    </div>
  );
}
