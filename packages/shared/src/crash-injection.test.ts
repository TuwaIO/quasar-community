import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CrashHookPoint,
  CrashInjectionError,
  isCrashInjectionEnabled,
  resetCrashInjection,
  setCrashInjectionPoint,
  triggerCrashHook,
} from './crash-injection.js';

describe('Crash Injection Framework', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    resetCrashInjection();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetCrashInjection();
  });

  it('should identify that crash injection is enabled in test environment', () => {
    expect(isCrashInjectionEnabled()).toBe(true);
  });

  it('should throw CrashInjectionError when active crash point is reached', () => {
    setCrashInjectionPoint(CrashHookPoint.SYNC_USAGE_AFTER_DB_COMMIT);

    expect(() => {
      triggerCrashHook(CrashHookPoint.SYNC_USAGE_BEFORE_READ);
    }).not.toThrow();

    expect(() => {
      triggerCrashHook(CrashHookPoint.SYNC_USAGE_AFTER_DB_COMMIT);
    }).toThrow(CrashInjectionError);
  });

  it('should invoke custom handler if provided when active crash point is reached', () => {
    const handler = vi.fn();
    setCrashInjectionPoint(CrashHookPoint.TRACKING_AFTER_DB_FLUSH_BEFORE_REDIS_TERMINAL, handler);

    triggerCrashHook(CrashHookPoint.TRACKING_AFTER_DB_FLUSH_BEFORE_REDIS_TERMINAL);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(CrashHookPoint.TRACKING_AFTER_DB_FLUSH_BEFORE_REDIS_TERMINAL);
  });

  it('should be a no-op when crash injection is disabled in non-test environment', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_CRASH_INJECTION;

    setCrashInjectionPoint(CrashHookPoint.SYNC_USAGE_AFTER_DB_COMMIT);

    expect(isCrashInjectionEnabled()).toBe(false);
    expect(() => {
      triggerCrashHook(CrashHookPoint.SYNC_USAGE_AFTER_DB_COMMIT);
    }).not.toThrow();
  });

  it('should remain disabled in production even when the legacy enable flag is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRASH_INJECTION = 'true';

    setCrashInjectionPoint(CrashHookPoint.SYNC_USAGE_AFTER_DB_COMMIT);

    expect(isCrashInjectionEnabled()).toBe(false);
    expect(() => triggerCrashHook(CrashHookPoint.SYNC_USAGE_AFTER_DB_COMMIT)).not.toThrow();
  });
});
