/** How long the dashboard keeps an interface setting after it is chosen (Cookie Policy; owner decision 2026-10-15). */
export const PREFERENCE_DAYS = 30;
export const PREFERENCE_MS = PREFERENCE_DAYS * 86_400_000;

interface StoredPreference {
  value: string;
  expiresAt: number;
}

const isStored = (v: unknown): v is StoredPreference =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as StoredPreference).value === 'string' &&
  typeof (v as StoredPreference).expiresAt === 'number';

/**
 * Interface settings in Local Storage that the dashboard forgets 30 days after they are set: the layout of the
 * sidebar and the number of rows of a table. A value saved before settings had an expiry is dropped on reading.
 * SSR-safe: nothing is read or written on the server.
 */
export const preferenceStorage = {
  get(key: string, now: number = Date.now()): string | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (isStored(parsed) && parsed.expiresAt > now) return parsed.value;
    window.localStorage.removeItem(key);
    return null;
  },
  set(key: string, value: string, now: number = Date.now()): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify({ value, expiresAt: now + PREFERENCE_MS }));
  },
  remove(key: string): void {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};
