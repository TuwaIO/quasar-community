/**
 * Shared UI Presentation tokens (Tailwind class strings)
 * Focus on visual-only constants to keep src/constants for logical configuration.
 */

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export const BTN_GRADIENT =
  'bg-[var(--tuwa-button-gradient-from)] hover:bg-[var(--tuwa-button-gradient-from-hover)] text-[var(--tuwa-text-on-accent)] font-mono font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

export const BTN_DANGER =
  'bg-[var(--tuwa-error-icon)] hover:opacity-90 text-white font-mono font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

export const BTN_SECONDARY =
  'text-[var(--tuwa-text-secondary)] hover:text-[var(--tuwa-text-primary)] font-mono font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

// ---------------------------------------------------------------------------
// Cards & Containers
// ---------------------------------------------------------------------------

export const CARD_BG = 'bg-[var(--tuwa-bg-secondary)]';
export const CARD_BORDER = 'border border-[var(--tuwa-border-primary)]';
export const CARD_BASE = `${CARD_BG} ${CARD_BORDER}`;

export const INNER_BG = 'bg-[var(--tuwa-bg-primary)]';
export const INNER_CARD = `${INNER_BG} ${CARD_BORDER}`;

// ---------------------------------------------------------------------------
// Text & Labels
// ---------------------------------------------------------------------------

export const LABEL_SM = 'text-[10px] font-bold text-[var(--tuwa-text-tertiary)] uppercase';

/** A transparent tinted background using the theme's accent color */
export const ACCENT_TINT =
  'bg-[var(--tuwa-button-gradient-from)]/10 border border-[var(--tuwa-button-gradient-from)]/20 text-[var(--tuwa-text-accent)]';
