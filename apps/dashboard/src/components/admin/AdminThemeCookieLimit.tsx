'use client';

import { type ReactNode, useEffect } from 'react';

import { limitAdminThemeCookie } from '@/lib/themePreference';

/**
 * Admin provider that keeps the theme cookie of the admin panel (`payload-theme`, which Payload sets for a year) only
 * 30 days after the theme was chosen, as the Cookie Policy says of every interface setting.
 */
export function AdminThemeCookieLimit({ children }: { children?: ReactNode }) {
  useEffect(() => {
    limitAdminThemeCookie();
  }, []);
  return <>{children}</>;
}
