'use client';

import { StarryBackground } from '@tuwaio/docs-ui';
import { cn } from '@tuwaio/sdk/nova-core/utils';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * The background of the sign-in pages: the starry sky of docs-ui from md up, soft accent orbs on phones.
 */
export function AuthBackground() {
  return (
    <>
      <div className="hidden md:block">
        <StarryBackground />
      </div>
      <div aria-hidden className="md:hidden pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-24 -right-20 w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/10 blur-3xl" />
        <div className="absolute top-1/3 -left-24 w-64 h-64 rounded-full bg-gradient-to-tr from-cyan-500/20 to-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-16 -right-16 w-80 h-80 rounded-full bg-gradient-to-tl from-purple-500/20 to-blue-500/10 blur-3xl" />
      </div>
    </>
  );
}

/**
 * The QUASAR title above the card of a sign-in page.
 */
export function AuthTitle({ children = 'QUASAR' }: { children?: ReactNode }) {
  return (
    <h1 className="font-mono text-[44px] sm:text-[60px] leading-none font-black tracking-[-0.03em] uppercase text-[var(--tuwa-text-primary)]">
      {children}
    </h1>
  );
}

/**
 * The card of a sign-in page: one column whose blocks are spaced by the card, not by their own margins.
 */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'w-full max-w-[440px] mx-auto flex flex-col gap-[18px] p-5 sm:p-7',
        'bg-white/85 dark:bg-[var(--tuwa-bg-secondary)]/85 backdrop-blur-md text-[var(--tuwa-text-primary)]',
        'border border-[var(--tuwa-border-primary)] rounded-[var(--tuwa-rounded-corners)] shadow-[0_20px_40px_rgba(17,24,39,0.08)]',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
