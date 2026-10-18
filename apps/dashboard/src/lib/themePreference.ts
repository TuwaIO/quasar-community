import { PREFERENCE_DAYS, PREFERENCE_MS } from './preferenceStorage';

/** When the theme stored under `theme` (next-themes) stops being remembered, as epoch milliseconds. */
export const THEME_EXPIRES_KEY = 'theme:expires';
const ADMIN_THEME_COOKIE = 'payload-theme';
const ADMIN_THEME_EXPIRES_KEY = 'payload-theme:expires';

/**
 * Forgets the chosen theme 30 days after it was chosen, and a theme saved before choices had an expiry. Runs as an
 * inline script in the page head, before the script of next-themes reads `theme`, so the page paints with the system
 * theme instead; it is serialised with `toString()`, so it uses no imports.
 */
export function expireThemeChoice(now: number = Date.now()): void {
  try {
    const expiresAt = Number(window.localStorage.getItem('theme:expires'));
    if (!expiresAt || expiresAt <= now) {
      window.localStorage.removeItem('theme');
      window.localStorage.removeItem('theme:expires');
    }
  } catch {
    // Storage blocked: next-themes falls back to the system theme as well
  }
}

/** Starts the 30 days of a theme the person just chose. */
export function rememberThemeChoice(now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_EXPIRES_KEY, String(now + PREFERENCE_MS));
}

/** The cookie that keeps the theme of the Payload admin panel, for 30 days. */
export const adminThemeCookie = (theme: 'light' | 'dark') =>
  `${ADMIN_THEME_COOKIE}=${theme}; path=/; max-age=${PREFERENCE_DAYS * 86_400}; SameSite=Lax`;

/**
 * The admin panel's own theme setting stores its cookie for a year. This keeps it 30 days after the choice: a new value
 * starts a new period, and the cookie is set again with the time left, or removed once it has passed.
 *
 * @returns The seconds the cookie is kept for, 0 when it was removed or there is none.
 */
export function limitAdminThemeCookie(now: number = Date.now()): number {
  if (typeof window === 'undefined') return 0;
  const value = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${ADMIN_THEME_COOKIE}=`))
    ?.split('=')[1];
  if (!value) {
    window.localStorage.removeItem(ADMIN_THEME_EXPIRES_KEY);
    return 0;
  }
  let stored: { value?: string; expiresAt?: number };
  try {
    stored = JSON.parse(window.localStorage.getItem(ADMIN_THEME_EXPIRES_KEY) ?? '{}');
  } catch {
    stored = {};
  }
  const expiresAt = stored.value === value && stored.expiresAt ? stored.expiresAt : now + PREFERENCE_MS;
  const seconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  if (seconds === 0) {
    document.cookie = `${ADMIN_THEME_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    window.localStorage.removeItem(ADMIN_THEME_EXPIRES_KEY);
    return 0;
  }
  window.localStorage.setItem(ADMIN_THEME_EXPIRES_KEY, JSON.stringify({ value, expiresAt }));
  document.cookie = `${ADMIN_THEME_COOKIE}=${value}; path=/; max-age=${seconds}; SameSite=Lax`;
  return seconds;
}
