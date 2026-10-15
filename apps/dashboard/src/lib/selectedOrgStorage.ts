const STORAGE_PREFIX = 'quasar_selected_org_id:';

const keyFor = (userId: string) => `${STORAGE_PREFIX}${userId}`;

export const selectedOrgStorage = {
  get: (userId: string): string | null => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(keyFor(userId));
  },
  set: (userId: string, orgId: string): void => {
    if (typeof window !== 'undefined') window.localStorage.setItem(keyFor(userId), orgId);
  },
  remove: (userId: string): void => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(keyFor(userId));
  },
};
