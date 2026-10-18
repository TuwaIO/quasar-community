import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useForgetOrganizationsWhenSignedOut } from '@/hooks/useForgetOrganizationsWhenSignedOut';
import { useTablePageSize } from '@/hooks/useTablePageSize';
import { PREFERENCE_DAYS, preferenceStorage } from '@/lib/preferenceStorage';
import { selectedOrgStorage } from '@/lib/selectedOrgStorage';
import {
  adminThemeCookie,
  expireThemeChoice,
  limitAdminThemeCookie,
  rememberThemeChoice,
  THEME_EXPIRES_KEY,
} from '@/lib/themePreference';

// Interface settings are kept for 30 days after they are chosen, not until the browser storage is cleared; the last
// organization lasts as long as the sign-in (Cookie Policy, owner decision 2026-10-15; lawyer round 8, 16.4)
const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 15);

beforeEach(() => {
  localStorage.clear();
  document.cookie.split('; ').forEach((c) => {
    document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`;
  });
});

describe('interface settings', () => {
  it('are kept for 30 days after they are set', () => {
    expect(PREFERENCE_DAYS).toBe(30);
    preferenceStorage.set('quasar_sidebar_collapsed', 'true', now);
    expect(preferenceStorage.get('quasar_sidebar_collapsed', now + 29 * DAY)).toBe('true');
    expect(preferenceStorage.get('quasar_sidebar_collapsed', now + 31 * DAY)).toBeNull();
    expect(localStorage.getItem('quasar_sidebar_collapsed')).toBeNull();
  });

  it('drop a value saved before they had an expiry', () => {
    localStorage.setItem('quasar_table_pagesize_apps_list', '25');
    expect(preferenceStorage.get('quasar_table_pagesize_apps_list', now)).toBeNull();
    expect(localStorage.getItem('quasar_table_pagesize_apps_list')).toBeNull();
  });
});

describe('the number of rows of a table', () => {
  it('is written only when the person changes it, and then kept for 30 days', () => {
    const { result } = renderHook(() => useTablePageSize('apps_list', 10));
    expect(result.current[0]).toBe(10);
    expect(localStorage.getItem('quasar_table_pagesize_apps_list')).toBeNull();

    act(() => result.current[1](25));
    expect(preferenceStorage.get('quasar_table_pagesize_apps_list')).toBe('25');
    expect(renderHook(() => useTablePageSize('apps_list', 10)).result.current[0]).toBe(25);
  });
});

describe('the theme', () => {
  it('is forgotten 30 days after it was chosen, before the theme script reads it', () => {
    localStorage.setItem('theme', 'light');
    rememberThemeChoice(now);
    expireThemeChoice(now + 29 * DAY);
    expect(localStorage.getItem('theme')).toBe('light');

    expireThemeChoice(now + 31 * DAY);
    expect(localStorage.getItem('theme')).toBeNull();
    expect(localStorage.getItem(THEME_EXPIRES_KEY)).toBeNull();
  });

  it('forgets a theme saved before it had an expiry', () => {
    localStorage.setItem('theme', 'dark');
    expireThemeChoice(now);
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('sets the admin theme cookie for 30 days', () => {
    expect(adminThemeCookie('dark')).toBe(`payload-theme=dark; path=/; max-age=${30 * 86_400}; SameSite=Lax`);
  });

  it('limits the theme cookie that the admin panel sets for a year to 30 days after the choice', () => {
    document.cookie = 'payload-theme=dark; path=/';
    expect(limitAdminThemeCookie(now)).toBe(30 * 86_400);
    expect(limitAdminThemeCookie(now + 10 * DAY)).toBe(20 * 86_400);

    // A new choice starts a new period
    document.cookie = 'payload-theme=light; path=/';
    expect(limitAdminThemeCookie(now + 20 * DAY)).toBe(30 * 86_400);

    expect(limitAdminThemeCookie(now + 51 * DAY)).toBe(0);
    expect(document.cookie).not.toContain('payload-theme=');
  });
});

describe('the last organization', () => {
  it('is forgotten when the sign-in page finds nobody signed in, not while the session loads', () => {
    selectedOrgStorage.set('user-a', 'org-a');
    renderHook(() => useForgetOrganizationsWhenSignedOut(undefined));
    renderHook(() => useForgetOrganizationsWhenSignedOut({ user: { id: 'user-a' } }));
    expect(selectedOrgStorage.get('user-a')).toBe('org-a');

    renderHook(() => useForgetOrganizationsWhenSignedOut(null));
    expect(selectedOrgStorage.get('user-a')).toBeNull();
  });

  it('is forgotten for every account when nobody is signed in', () => {
    selectedOrgStorage.set('user-a', 'org-a');
    selectedOrgStorage.set('user-b', 'org-b');
    localStorage.setItem('theme', 'dark');

    selectedOrgStorage.clearAll();

    expect(selectedOrgStorage.get('user-a')).toBeNull();
    expect(selectedOrgStorage.get('user-b')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
