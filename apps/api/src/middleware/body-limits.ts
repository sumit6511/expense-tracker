import {
  MAX_AI_FILE_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BACKUP_BYTES,
} from '@et/shared';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../context';

const KB = 1024;
const MB = 1024 * KB;
/** Room for multipart headers around an uploaded file. */
const FORM_OVERHEAD = 64 * KB;

/** Most requests are small JSON; a larger body is refused before it's read into memory. */
export const DEFAULT_BODY_LIMIT = 1 * MB;

/** Endpoints that take more, with what to tell people who go over. */
const LARGER: Array<{ path: RegExp; bytes: number; message: string }> = [
  {
    path: /\/transactions\/[^/]+\/attachments$/,
    bytes: MAX_ATTACHMENT_BYTES + FORM_OVERHEAD,
    message: 'Files can be at most 5 MB',
  },
  {
    path: /\/me\/avatar$/,
    bytes: MAX_AVATAR_BYTES + FORM_OVERHEAD,
    message: 'Photos can be at most 512 KB',
  },
  {
    path: /\/ai\/(receipt|statement)$/,
    bytes: MAX_AI_FILE_BYTES + FORM_OVERHEAD,
    message: 'Files can be at most 10 MB',
  },
  // Up to 5,000 rows a request.
  { path: /\/imports(\/preview)?$/, bytes: 16 * MB, message: 'Imports can be at most 16 MB' },
  {
    path: /\/workspaces\/restore$/,
    bytes: MAX_BACKUP_BYTES,
    message: 'Backups can be at most 50 MB',
  },
];

function limit(bytes: number, message: string): MiddlewareHandler<AppEnv> {
  return bodyLimit({
    maxSize: bytes,
    onError: (c) => c.json({ error: { code: 'too_large', message } }, 413),
  });
}

/**
 * Caps request bodies by endpoint, checked against Content-Length up front and while streaming,
 * so an oversized request can't fill the server's memory (signed in or not).
 */
export function bodyLimits(): MiddlewareHandler<AppEnv> {
  const fallback = limit(DEFAULT_BODY_LIMIT, 'The request is too large');
  const rules = LARGER.map((r) => ({ path: r.path, handler: limit(r.bytes, r.message) }));
  return (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    const rule = rules.find((r) => r.path.test(c.req.path));
    return (rule?.handler ?? fallback)(c, next);
  };
}

/** Better Auth's endpoints (sign-in, sign-up, passkeys…) only ever take small JSON. */
export const authBodyLimit = () => limit(128 * KB, 'The request is too large');
