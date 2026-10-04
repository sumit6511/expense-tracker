import type { ErrorComponentProps } from '@tanstack/react-router';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { EmptyState } from '@/components/page';
import { Button } from '@/components/ui/button';

/** A page's code couldn't load: usually a new version was deployed and old files are gone. */
function isStaleChunk(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(
    message,
  );
}

/**
 * Shown in place of a page that crashed. (A page whose code went missing after a deploy has
 * already been reloaded once by the router's lazy loading; if that didn't help, we land here.)
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const stale = isStaleChunk(error);

  return (
    <div className="grid grid-cols-1 min-h-[60dvh] place-items-center p-6" role="alert">
      <EmptyState
        icon={stale ? RefreshCw : TriangleAlert}
        title={stale ? 'A new version is available' : 'Something went wrong'}
        description={
          stale
            ? 'The app was updated while it was open. Reload to get the new version.'
            : 'This page ran into a problem. Your data is safe; try again, or reload the app.'
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw /> Reload
            </Button>
            {!stale && (
              <Button variant="outline" onClick={reset}>
                Try again
              </Button>
            )}
            <Button variant="ghost" asChild>
              <a href="/">Go to dashboard</a>
            </Button>
          </div>
        }
      />
      {!stale && error instanceof Error && error.message && (
        <p className="mt-2 max-w-md text-center text-xs break-words text-muted-foreground">
          {error.message}
        </p>
      )}
    </div>
  );
}
