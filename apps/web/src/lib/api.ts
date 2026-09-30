import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

/** Thin fetch wrapper for the JSON API. Errors carry the API's `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

export function toQueryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(
  url: string,
  init: RequestInit,
  /** A 401 here means "wrong code", not "signed out": don't send the person to the login page. */
  { quiet401 = false } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !quiet401) onUnauthorized?.();
    const err =
      (body as {
        error?: { code?: string; message?: string; details?: unknown };
        message?: string;
      } | null) ?? {};
    throw new ApiError(
      res.status,
      err.error?.code ?? 'error',
      err.error?.message ?? err.message ?? `Request failed (${res.status})`,
      err.error?.details,
    );
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; quiet401?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, query, quiet401 } = options;
  return request<T>(
    `/api/v1${path}${toQueryString(query)}`,
    {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    { quiet401 },
  );
}

/** Sends a file as multipart/form-data (the browser sets the boundary). */
export function apiUpload<T>(path: string, file: Blob, fileName: string): Promise<T> {
  const form = new FormData();
  form.append('file', file, fileName);
  return request<T>(`/api/v1${path}`, { method: 'POST', body: form });
}

/** Better Auth endpoints (cookie sessions). */
export const authApi = {
  signUp: (input: { name: string; email: string; password: string }) =>
    request<{ user: { id: string } }>('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  signIn: (input: { email: string; password: string; rememberMe?: boolean }) =>
    request<{ user?: { id: string }; twoFactorRedirect?: boolean }>('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  signOut: () =>
    request<unknown>('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  changePassword: (input: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions?: boolean;
  }) =>
    request<unknown>('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  deleteUser: (password: string) =>
    request<unknown>('/api/auth/delete-user', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
  twoFactor: {
    /** Starts setup: returns the authenticator URI and backup codes (not on until verified). */
    enable: (password: string) =>
      authPost<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', { password }),
    verifyTotp: (code: string, trustDevice = false) =>
      authPost<unknown>('/two-factor/verify-totp', { code, trustDevice }),
    verifyBackupCode: (code: string, trustDevice = false) =>
      authPost<unknown>('/two-factor/verify-backup-code', { code, trustDevice }),
    disable: (password: string) => authPost<unknown>('/two-factor/disable', { password }),
    newBackupCodes: (password: string) =>
      authPost<{ backupCodes: string[] }>('/two-factor/generate-backup-codes', { password }),
  },
  passkey: {
    registrationOptions: () =>
      request<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/passkey/generate-register-options',
        { method: 'GET' },
        { quiet401: true },
      ),
    verifyRegistration: (response: unknown, name: string) =>
      authPost<Passkey>('/passkey/verify-registration', { response, name }),
    authenticationOptions: () =>
      request<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/passkey/generate-authenticate-options',
        { method: 'GET' },
        { quiet401: true },
      ),
    verifyAuthentication: (response: unknown) =>
      authPost<unknown>('/passkey/verify-authentication', { response }),
    list: () => request<Passkey[]>('/api/auth/passkey/list-user-passkeys', { method: 'GET' }),
    rename: (id: string, name: string) =>
      authPost<unknown>('/passkey/update-passkey', { id, name }),
    remove: (id: string) => authPost<unknown>('/passkey/delete-passkey', { id }),
  },
};

export interface Passkey {
  id: string;
  name?: string | null;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  aaguid?: string | null;
  createdAt: string;
}

function authPost<T>(path: string, body: unknown) {
  return request<T>(
    `/api/auth${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { quiet401: true },
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
