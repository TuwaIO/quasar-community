'use client';

import loader from '@monaco-editor/loader';
import type { ReactNode } from 'react';

// The code editor of Payload (JSON and code fields) loads Monaco from this site (public/monaco/vs, copied by
// scripts/copy-monaco.mjs), not from jsDelivr, which @monaco-editor/loader defaults to
loader.config({ paths: { vs: '/monaco/vs' } });

/** Admin provider that only configures the Monaco loader before any editor mounts. */
export function MonacoLocalProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
