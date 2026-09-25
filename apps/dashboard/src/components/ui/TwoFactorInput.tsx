'use client';

import { cn } from '@tuwaio/sdk/nova-core';
import { motion } from 'framer-motion';
import React, { useLayoutEffect, useRef } from 'react';

import { TOTP_CODE_LENGTH } from '@/constants';

interface TwoFactorInputProps {
  digits: string[];
  setDigits: (digits: string[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  onComplete?: () => void;
  className?: string;
  inputClassName?: string;
}

export function TwoFactorInput({
  digits,
  setDigits,
  disabled = false,
  autoFocus = true,
  onComplete,
  className,
  inputClassName,
}: TwoFactorInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const focusDigit = (index: number) => {
    inputRefs.current[index]?.focus();
    inputRefs.current[index]?.select();
  };

  const setDigitAtIndex = (index: number, value: string) => {
    const next = [...digits];
    next[index] = value;
    setDigits(next);
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setDigitAtIndex(index, digit);

    if (digit && index < TOTP_CODE_LENGTH - 1) {
      focusDigit(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        setDigitAtIndex(index, '');
        return;
      }

      if (index > 0) {
        focusDigit(index - 1);
        setDigitAtIndex(index - 1, '');
      }
    }

    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusDigit(index - 1);
    }

    if (e.key === 'ArrowRight' && index < TOTP_CODE_LENGTH - 1) {
      e.preventDefault();
      focusDigit(index + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();

    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH);
    if (!pasted) return;

    const newDigits = [...digits];
    for (let i = 0; i < pasted.length; i += 1) {
      if (i < TOTP_CODE_LENGTH) {
        newDigits[i] = pasted[i];
      }
    }

    setDigits(newDigits);

    const nextFocusIndex = Math.min(pasted.length, TOTP_CODE_LENGTH - 1);
    focusDigit(nextFocusIndex);
  };

  useLayoutEffect(() => {
    if (autoFocus) {
      focusDigit(0);
    }
  }, [autoFocus]);

  useLayoutEffect(() => {
    if (onComplete && digits.every((d) => d !== '')) {
      onComplete();
    }
  }, [digits, onComplete]);

  return (
    <div className={cn('flex items-center justify-center gap-2.5', className)}>
      {Array.from({ length: TOTP_CODE_LENGTH }).map((_, index) => {
        const isFilled = Boolean(digits[index]);

        return (
          <motion.input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            value={digits[index]}
            onChange={(e) => handleDigitChange(index, e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => handleKeyDown(index, e)}
            whileFocus={{ scale: 1.04 }}
            className={cn(
              'h-14 w-12 rounded-[var(--tuwa-rounded-corners)] border text-center text-xl font-bold outline-none transition-all shadow-sm',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'border-[var(--tuwa-border-primary)] bg-[var(--tuwa-bg-primary)] text-[var(--tuwa-text-primary)] placeholder-[var(--tuwa-text-tertiary)]',
              'hover:border-[var(--tuwa-border-hover,var(--tuwa-border-primary))] hover:bg-[var(--tuwa-bg-muted)]',
              'focus:ring-2 focus:ring-[var(--tuwa-text-accent)]/20 focus:border-[var(--tuwa-text-accent)]',
              inputClassName,
              isFilled && 'border-[var(--tuwa-border-hover,var(--tuwa-border-primary))]',
            )}
            maxLength={1}
            disabled={disabled}
            aria-label={`Digit ${index + 1}`}
          />
        );
      })}
    </div>
  );
}
