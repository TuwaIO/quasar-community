'use client';

import { cn } from '@tuwaio/sdk/nova-core';
import { type HTMLMotionProps, motion } from 'framer-motion';
import React from 'react';

import { BTN_DANGER, BTN_GRADIENT, BTN_SECONDARY } from '@/styles/ui';

type ButtonVariant = 'gradient' | 'danger' | 'secondary' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  children?: React.ReactNode;
}

export function Button({
  variant = 'gradient',
  size = 'md',
  isLoading = false,
  icon,
  iconPosition = 'left',
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case 'gradient':
        return BTN_GRADIENT;
      case 'danger':
        return BTN_DANGER;
      case 'secondary':
        return BTN_SECONDARY;
      case 'outline':
        return 'border border-[var(--tuwa-border-primary)] hover:bg-[var(--tuwa-bg-muted)] text-[var(--tuwa-text-primary)] font-mono font-bold transition-all';
      case 'ghost':
        return 'hover:bg-[var(--tuwa-bg-muted)] text-[var(--tuwa-text-secondary)] hover:text-[var(--tuwa-text-primary)] font-mono font-bold transition-all';
      default:
        return BTN_GRADIENT;
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'px-4 py-2 text-xs font-mono';
      case 'lg':
        return 'px-8 py-4 text-base font-mono font-bold';
      case 'icon':
        return 'p-2 w-10 h-10 font-mono font-bold';
      case 'md':
      default:
        return 'px-6 py-3 text-sm font-mono font-bold';
    }
  };

  const isDisabled = disabled || isLoading;

  return (
    <motion.button
      whileHover={!isDisabled ? { scale: 1.02 } : undefined}
      whileTap={!isDisabled ? { scale: 0.98 } : undefined}
      className={cn(
        'relative flex items-center justify-center gap-2 font-mono font-bold rounded-[var(--tuwa-rounded-corners)] transition-all shadow-sm',
        getVariantClasses(),
        getSizeClasses(),
        isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit rounded-inherit z-10">
          <svg
            className="animate-spin h-[1.2em] w-[1.2em] text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
      )}

      <span className={cn('flex items-center gap-2 font-mono', isLoading && 'invisible')}>
        {icon && iconPosition === 'left' && <span className="shrink-0">{icon}</span>}
        {children}
        {icon && iconPosition === 'right' && <span className="shrink-0">{icon}</span>}
      </span>
    </motion.button>
  );
}
