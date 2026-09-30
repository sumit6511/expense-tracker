import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/page';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="grid grid-cols-1 min-h-dvh place-items-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="That page doesn’t exist, or it moved."
        action={
          <Button asChild>
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </div>
  );
}
