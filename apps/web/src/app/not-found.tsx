import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { usePageTitle } from '@/lib/page-title';

export function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <main className="grid grid-cols-1 min-h-dvh place-items-center">
      <EmptyState
        as="h1"
        icon={Compass}
        title="Page not found"
        description="That page doesn’t exist, or it moved."
        action={
          <Button asChild>
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </main>
  );
}
