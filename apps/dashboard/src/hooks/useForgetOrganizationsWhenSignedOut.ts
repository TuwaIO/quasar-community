'use client';

import { useEffect } from 'react';

import { selectedOrgStorage } from '@/lib/selectedOrgStorage';

/**
 * The last organization lasts as long as a sign-in (Cookie Policy): once the sign-in page knows nobody is signed in
 * (after a sign-out or an expired session), it forgets it for every account. Nothing happens while the session loads.
 *
 * @param me - The answer of `/api/v1/users/me`: `undefined` while loading, `null` when nobody is signed in.
 */
export function useForgetOrganizationsWhenSignedOut(me: { user?: unknown } | null | undefined) {
  const signedOut = me === null || (me !== undefined && !me.user);
  useEffect(() => {
    if (signedOut) selectedOrgStorage.clearAll();
  }, [signedOut]);
}
