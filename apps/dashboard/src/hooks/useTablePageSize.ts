'use client';

import { useCallback, useState } from 'react';

import { preferenceStorage } from '@/lib/preferenceStorage';

/**
 * The number of rows of a table, remembered for 30 days once the person changes it (Cookie Policy).
 * @param tableKey Unique identifier for the table (e.g., 'billing', 'deliveries', 'transactions')
 * @param defaultSize Default page size if none is stored
 */
export function useTablePageSize(tableKey: string, defaultSize: number = 10) {
  const storageKey = `quasar_table_pagesize_${tableKey}`;

  const [pageSize, setStoredPageSize] = useState<number>(() => {
    const stored = Number(preferenceStorage.get(storageKey));
    return stored > 0 ? stored : defaultSize;
  });

  // Written only when the person picks a number, never on load
  const setPageSize = useCallback(
    (size: number) => {
      preferenceStorage.set(storageKey, String(size));
      setStoredPageSize(size);
    },
    [storageKey],
  );

  return [pageSize, setPageSize] as const;
}
