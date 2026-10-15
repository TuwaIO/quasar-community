export type AuthMethod = 'siwx' | 'standard';

const STORAGE_KEY = 'quasar:auth_method';

/**
 * SSR-safe helpers for managing the `auth_method` flag in localStorage.
 *
 * - `'siwx'`     — session is wallet-bound (disconnect = logout). Set when the user first logs in via SIWX (wallet signature).
 * - `'standard'` — session is independent of wallet state. Set when the user logs in via email/password or passkey.
 */
export const authMethodStorage = {
  STORAGE_KEY,

  /** Persist the auth method. No-op in SSR. */
  set: (method: AuthMethod): void => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, method);
  },

  /** Read the current value from storage. `undefined` in SSR. */
  get: (): AuthMethod | null | undefined => {
    if (typeof window === 'undefined') return undefined;
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'siwx' || value === 'standard' ? value : null;
  },

  /** Remove the flag. No-op in SSR. */
  remove: (): void => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(STORAGE_KEY);
  },
} as const;
