'use client';

import { cn } from '@tuwaio/sdk/nova-core/utils';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { type ReactNode, useId } from 'react';

import styles from './CheckboxField.module.css';

interface CheckboxFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The label: a click on it toggles the box */
  children: ReactNode;
  /** A line under the label, read by screen readers as the description of the box */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

// The box gives a little when it is ticked or unticked; a ripple spreads from it only when it is ticked
const BOX_VARIANTS: Variants = {
  checked: { scale: [1, 0.84, 1.08, 1], transition: { duration: 0.36, ease: 'easeOut' } },
  unchecked: { scale: [1, 0.9, 1], transition: { duration: 0.22, ease: 'easeOut' } },
};
const RIPPLE_VARIANTS: Variants = {
  checked: { opacity: [0.35, 0], scale: [1, 2.3], transition: { duration: 0.55, ease: 'easeOut' } },
  unchecked: { opacity: 0, scale: 1, transition: { duration: 0 } },
};

/**
 * The one checkbox of Quasar, in the dashboard and in the admin panel, in the style of "Remember this wallet" of Nova
 * Connect: a drawn box over a visually hidden native checkbox, so keyboards and screen readers use the native control.
 * Ticking it draws the check mark with a short bounce and ripple; with `prefers-reduced-motion` nothing moves.
 */
export function CheckboxField({ checked, onChange, children, description, disabled, className }: CheckboxFieldProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const labelId = useId();
  const descriptionId = useId();
  const state = checked ? 'checked' : 'unchecked';

  return (
    <label className={cn(styles.field, disabled && styles.disabled, className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className={styles.input}
      />
      <motion.span
        aria-hidden="true"
        data-state={state}
        initial={false}
        animate={reduceMotion ? undefined : state}
        variants={BOX_VARIANTS}
        className={styles.box}
      >
        {!reduceMotion && (
          <motion.span initial={false} animate={state} variants={RIPPLE_VARIANTS} className={styles.ripple} />
        )}
        <svg viewBox="0 0 16 16" fill="none" className={styles.check}>
          <motion.path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: checked ? 0.26 : 0.14, delay: checked ? 0.06 : 0, ease: 'easeOut' }
            }
          />
        </svg>
      </motion.span>
      <span className={styles.text}>
        <span id={labelId}>{children}</span>
        {description && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
