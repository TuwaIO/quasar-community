'use client';

import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { cn } from '@tuwaio/sdk/nova-core/utils';
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';

const HEADING_TONES = {
  accent: 'bg-[var(--tuwa-text-accent)]/10 text-[var(--tuwa-text-accent)]',
  success: 'bg-emerald-500/10 text-emerald-500',
  error: 'bg-red-500/10 text-red-500',
} as const;

interface AuthHeadingProps {
  icon?: ComponentType<{ className?: string }>;
  /** Shows a spinner in the circle instead of the icon. */
  spinner?: boolean;
  title: ReactNode;
  description?: ReactNode;
  tone?: keyof typeof HEADING_TONES;
}

/**
 * The top of a one-purpose card (recovery, verification, 2FA): an icon in a circle, the title and what to do.
 */
export function AuthHeading({ icon: Icon, spinner, title, description, tone = 'accent' }: AuthHeadingProps) {
  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <span
        aria-hidden
        className={cn('w-14 h-14 shrink-0 rounded-full flex items-center justify-center', HEADING_TONES[tone])}
      >
        {spinner ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-current/25 border-t-current" />
        ) : (
          Icon && <Icon className="w-[26px] h-[26px]" />
        )}
      </span>
      <h2 className="font-mono text-[22px] leading-tight font-bold tracking-[-0.025em] text-[var(--tuwa-text-primary)]">
        {title}
      </h2>
      {description && (
        <p className="text-sm leading-[1.55] text-[var(--tuwa-text-secondary)] whitespace-pre-line">{description}</p>
      )}
    </div>
  );
}

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline';
  /** Shows a spinner and `pendingLabel` and disables the button. */
  pending?: boolean;
  pendingLabel?: ReactNode;
  /** An arrow after the label that moves on hover (Sign In, Create Account). */
  chevron?: boolean;
}

/**
 * The full-width 48 px button of the sign-in pages.
 */
export function AuthButton({
  variant = 'primary',
  pending,
  pendingLabel,
  chevron,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: AuthButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      className={cn(
        'group w-full h-12 inline-flex items-center justify-center gap-2 px-4 rounded-[var(--tuwa-rounded-corners)]',
        'font-mono text-sm font-bold tracking-[-0.025em] cursor-pointer transition-all outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--tuwa-text-accent)]/40 disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary'
          ? 'bg-[var(--tuwa-text-accent)] text-[var(--tuwa-text-on-accent)] shadow-md enabled:hover:opacity-90 enabled:active:scale-[0.99]'
          : 'border border-[var(--tuwa-border-primary)] bg-[var(--tuwa-bg-primary)] text-[var(--tuwa-text-primary)] enabled:hover:bg-[var(--tuwa-bg-muted)]',
        className,
      )}
      {...props}
    >
      {pending ? (
        <>
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          {chevron && (
            <ChevronRightIcon
              aria-hidden
              className="h-4 w-4 stroke-[2.5] transition-transform group-enabled:group-hover:translate-x-1"
            />
          )}
        </>
      )}
    </button>
  );
}

/**
 * A secondary action under the card's button (Back to Login, Cancel, Log out): an accent text link, centred.
 */
export function AuthTextButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'self-center inline-flex items-center gap-1.5 font-mono text-[13px] font-bold tracking-[-0.025em] text-[var(--tuwa-text-accent)] hover:underline cursor-pointer outline-none focus-visible:underline',
        className,
      )}
      {...props}
    />
  );
}
