/**
 * Named crash injection points used to simulate process failure
 * during multi-step distributed operations (e.g. Quota Sync, Tracking Persistence).
 */
export enum CrashHookPoint {
  // Sync Usage / Quota Ledger crash points
  SYNC_USAGE_BEFORE_READ = 'SYNC_USAGE_BEFORE_READ',
  SYNC_USAGE_AFTER_READ = 'SYNC_USAGE_AFTER_READ',
  SYNC_USAGE_AFTER_LEDGER_INSERT = 'SYNC_USAGE_AFTER_LEDGER_INSERT',
  SYNC_USAGE_AFTER_QUOTA_MUTATION = 'SYNC_USAGE_AFTER_QUOTA_MUTATION',
  SYNC_USAGE_AFTER_DB_COMMIT = 'SYNC_USAGE_AFTER_DB_COMMIT',
  SYNC_USAGE_BEFORE_REDIS_DEL = 'SYNC_USAGE_BEFORE_REDIS_DEL',
  SYNC_USAGE_AFTER_REDIS_DEL = 'SYNC_USAGE_AFTER_REDIS_DEL',
  SYNC_USAGE_DURING_RESCUE = 'SYNC_USAGE_DURING_RESCUE',

  // Tracking Engine persistence crash points
  TRACKING_BEFORE_DB_FLUSH = 'TRACKING_BEFORE_DB_FLUSH',
  TRACKING_AFTER_DB_FLUSH_BEFORE_REDIS_TERMINAL = 'TRACKING_AFTER_DB_FLUSH_BEFORE_REDIS_TERMINAL',
  TRACKING_AFTER_REDIS_TERMINAL = 'TRACKING_AFTER_REDIS_TERMINAL',

  // Webhook delivery crash points
  WEBHOOK_BEFORE_DELIVERY = 'WEBHOOK_BEFORE_DELIVERY',
  WEBHOOK_AFTER_DELIVERY_BEFORE_DB = 'WEBHOOK_AFTER_DELIVERY_BEFORE_DB',
}

export class CrashInjectionError extends Error {
  constructor(public readonly point: CrashHookPoint) {
    super(`[CrashInjection] Induced process crash at hook point: ${point}`);
    this.name = 'CrashInjectionError';
  }
}

type CrashHookHandler = (point: CrashHookPoint) => void;

let activeCrashPoint: CrashHookPoint | null = null;
let customHandler: CrashHookHandler | null = null;

/**
 * Configure an active crash point for test simulations.
 * Crash injection is only functional when NODE_ENV === 'test'.
 */
export function setCrashInjectionPoint(point: CrashHookPoint | null, handler?: CrashHookHandler): void {
  activeCrashPoint = point;
  customHandler = handler || null;
}

/**
 * Clears all active crash injection configuration.
 */
export function resetCrashInjection(): void {
  activeCrashPoint = null;
  customHandler = null;
}

/**
 * Checks if crash injection is globally enabled via environment guards.
 */
export function isCrashInjectionEnabled(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * Hook trigger placed inside critical multi-step distributed execution paths.
 * In production, this is a strictly guarded zero-overhead no-op.
 */
export function triggerCrashHook(point: CrashHookPoint): void {
  if (!isCrashInjectionEnabled()) {
    return;
  }

  if (activeCrashPoint === point) {
    if (customHandler) {
      customHandler(point);
    } else {
      throw new CrashInjectionError(point);
    }
  }
}
