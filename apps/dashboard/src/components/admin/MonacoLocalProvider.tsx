'use client';

import loader from '@monaco-editor/loader';
import type { ReactNode } from 'react';

// Monaco, the code editor of JSON and code fields, loads from this site (public/monaco/vs, copied by
// scripts/copy-monaco.mjs), not from jsDelivr, which @monaco-editor/loader defaults to. This configures the
// @monaco-editor/loader package, which the unbundled CodeEditor of @payloadcms/ui and custom editors use; the copy of the
// loader bundled into the client code of @payloadcms/ui is rewritten at build time (scripts/monaco-local-loader.cjs).
loader.config({ paths: { vs: '/monaco/vs' } });

/** Admin provider that only configures the Monaco loader package before any editor mounts. */
export function MonacoLocalProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
