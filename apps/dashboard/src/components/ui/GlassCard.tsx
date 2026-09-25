'use client';

import { cn } from '@tuwaio/sdk/nova-core';
import { motion, MotionProps } from 'framer-motion';
import { ReactNode } from 'react';

interface GlassCardProps extends MotionProps {
  children: ReactNode;
  className?: string;
}

export default function GlassCard({ children, className, ...motionProps }: GlassCardProps) {
  return (
    <motion.div
      className={cn(
        'bg-[var(--tuwa-bg-secondary)] border border-[var(--tuwa-border-primary)] text-[var(--tuwa-text-primary)] rounded-[var(--tuwa-rounded-corners)] p-6 sm:p-8 w-full max-w-md mx-auto shadow-2xl transition-colors duration-300',
        className,
      )}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}
