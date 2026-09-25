'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@tuwaio/sdk/nova-core';
import React from 'react';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
  delayDuration?: number;
}

/**
 * A premium Tooltip component powered by Radix UI.
 * Resolves hydration and "second hover" issues by using a direct React component tree.
 */
export const Tooltip = ({
  children,
  content,
  side = 'top',
  align = 'center',
  className,
  delayDuration = 200,
}: TooltipProps) => {
  const [open, setOpen] = React.useState(false);

  const handleTriggerClick = () => {
    // Only toggle on click for touch devices
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      setOpen((v) => !v);
    }
  };

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild onClick={handleTriggerClick}>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={8}
            className={cn(
              'z-[9999] overflow-hidden rounded-[var(--tuwa-rounded-corners)] bg-[var(--tuwa-bg-secondary)] px-4 py-2 text-[11px] font-bold leading-relaxed text-[var(--tuwa-text-primary)] border border-[var(--tuwa-border-primary)] shadow-2xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-w-[210px]',
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[var(--tuwa-bg-secondary)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
};
