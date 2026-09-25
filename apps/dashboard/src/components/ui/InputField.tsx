'use client';

import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { cn } from '@tuwaio/sdk/nova-core';
import { AnimatePresence, motion } from 'framer-motion';
import { ComponentType, InputHTMLAttributes } from 'react';

import { Tooltip } from './Tooltip';

type InputVariant = 'default' | 'nova';

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: ComponentType<{ className?: string }>;
  trailingIcon?: ComponentType<{ className?: string }>;
  onTrailingIconClick?: () => void;
  wrapperClassName?: string;
  hasError?: boolean;
  errorMessage?: string;
  variant?: InputVariant;
  tooltipContent?: string;
}

const variantStyles: Record<
  InputVariant,
  { input: string; icon: string; trailingIcon: string; trailingHover: string; hoverBg: string }
> = {
  default: {
    input: [
      'bg-[var(--tuwa-bg-primary)] border-[var(--tuwa-border-primary)] text-[var(--tuwa-text-primary)] placeholder-[var(--tuwa-text-tertiary)] shadow-sm',
      'hover:border-[var(--tuwa-border-primary)] hover:bg-[var(--tuwa-bg-muted)]',
      'focus:ring-2 focus:ring-[var(--tuwa-text-accent)]/20 focus:border-[var(--tuwa-text-accent)]',
    ].join(' '),
    icon: 'text-[var(--tuwa-text-tertiary)]',
    trailingIcon: 'text-[var(--tuwa-text-tertiary)] group-hover/btn:text-[var(--tuwa-text-secondary)]',
    trailingHover: 'hover:bg-[var(--tuwa-bg-muted)]',
    hoverBg: 'text-[var(--tuwa-text-tertiary)]',
  },
  nova: {
    input: [
      'bg-[var(--tuwa-bg-secondary)] border-[var(--tuwa-border-primary)] text-[var(--tuwa-text-primary)] placeholder-[var(--tuwa-text-tertiary)]',
      'hover:border-[var(--tuwa-border-hover,var(--tuwa-border-primary))] hover:bg-[var(--tuwa-bg-muted)]',
      'focus:ring-[var(--tuwa-focus-ring,theme(colors.indigo.500/0.5))] focus:border-[var(--tuwa-focus-ring,theme(colors.indigo.500/0.5))]',
    ].join(' '),
    icon: 'text-[var(--tuwa-text-tertiary)]',
    trailingIcon: 'text-[var(--tuwa-text-tertiary)] group-hover/btn:text-[var(--tuwa-text-secondary)]',
    trailingHover: 'hover:bg-[var(--tuwa-bg-muted)]',
    hoverBg: 'text-[var(--tuwa-text-tertiary)]',
  },
};

const errorStyles: Record<InputVariant, string> = {
  default: 'border-red-500/60 bg-red-500/5 hover:border-red-500/80 focus:ring-red-500/40 focus:border-red-500/60',
  nova: 'border-[var(--tuwa-error-text)]/60 bg-[var(--tuwa-error-bg)] hover:border-[var(--tuwa-error-text)]/80 focus:ring-[var(--tuwa-error-text)]/40 focus:border-[var(--tuwa-error-text)]/60',
};

export default function InputField({
  label,
  icon: Icon,
  trailingIcon: TrailingIcon,
  onTrailingIconClick,
  className,
  wrapperClassName,
  hasError,
  errorMessage,
  variant = 'default',
  tooltipContent,
  required,
  ...props
}: InputFieldProps) {
  const v = variantStyles[variant];
  const activeError = hasError || !!errorMessage;

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <div className="flex items-center gap-2 ml-1">
          <label
            htmlFor={props.id || props.name}
            className={cn(
              'text-[10px] font-bold uppercase tracking-widest',
              variant === 'default' ? 'text-slate-600 dark:text-gray-400' : 'text-[var(--tuwa-text-tertiary)]',
            )}
          >
            {label}
            {required && <span className="ml-1 text-red-500">*</span>}
          </label>
          {tooltipContent && (
            <Tooltip content={tooltipContent}>
              <InformationCircleIcon className="w-3.5 h-3.5 text-[var(--tuwa-text-tertiary)] cursor-help outline-none" />
            </Tooltip>
          )}
        </div>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
            <Icon className={cn('w-5 h-5 pointer-events-none', v.icon)} />
          </div>
        )}
        <input
          id={props.id || props.name}
          className={cn(
            'w-full border rounded-[var(--tuwa-rounded-corners)] px-4 py-3',
            'focus:outline-none focus:ring-2',
            'transition-all duration-200 cursor-text',
            v.input,
            activeError && errorStyles[variant],
            Icon && 'pl-12',
            TrailingIcon && 'pr-12',
            className,
          )}
          {...props}
        />
        {TrailingIcon && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
            {onTrailingIconClick ? (
              <button
                type="button"
                onClick={onTrailingIconClick}
                style={{ background: 'transparent', border: 'none', outline: 'none' }}
                className={cn(
                  'cursor-pointer group/btn p-1 -m-1 rounded-md transition-colors focus:outline-none',
                  v.trailingHover,
                )}
              >
                <TrailingIcon className={cn('w-5 h-5 transition-colors', v.trailingIcon)} />
              </button>
            ) : (
              <TrailingIcon className={cn('w-5 h-5 pointer-events-none', v.hoverBg)} />
            )}
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {errorMessage && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className={cn(
              'text-xs ml-1 font-medium overflow-hidden',
              variant === 'default' ? 'text-red-400' : 'text-[var(--tuwa-error-text)]',
            )}
          >
            {errorMessage}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
