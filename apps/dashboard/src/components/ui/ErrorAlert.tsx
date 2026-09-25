'use client';

import { AnimatePresence, motion } from 'framer-motion';

interface ErrorAlertProps {
  message: string;
}

export default function ErrorAlert({ message }: ErrorAlertProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key="error"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.15 } }}
          exit={{ opacity: 0 }}
          className="mb-6 p-4 rounded-[var(--tuwa-rounded-corners)] bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
