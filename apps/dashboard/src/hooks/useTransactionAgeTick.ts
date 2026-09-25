'use client';

import { useEffect, useState } from 'react';

/**
 * Keeps time-based pending actions reactive while the page remains open.
 */
export function useTransactionAgeTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
