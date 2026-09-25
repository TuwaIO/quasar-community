'use client';

import './css.css';

import {
  ChevronRightIcon,
  EnvelopeIcon,
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useForm, useStore } from '@tanstack/react-form';
import { StarryBackground, ThemeSwitcher } from '@tuwaio/docs-ui';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import ErrorAlert from '@/components/ui/ErrorAlert';
import GlassCard from '@/components/ui/GlassCard';
import InputField from '@/components/ui/InputField';
import { TwoFactorInput } from '@/components/ui/TwoFactorInput';
import { UI_TEXT } from '@/constants/ui-text';

const fieldTransition = {
  duration: 0.28,
  ease: [0.4, 0, 0.2, 1] as const,
};

/**
 * Custom administrative authentication view matching the primary TUWA client auth design.
 * Uses official docs-ui ThemeSwitcher with synchronous DOM + cookie toggling,
 * TOTP Two-Factor Authentication, and StarryBackground without extra ThemeProvider wrappers.
 */
export default function CustomLogin() {
  const router = useRouter();
  const [step, setStep] = useState<'login' | '2fa'>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Synchronize theme with documentElement, cookies, and local storage on mount
  useEffect(() => {
    setMounted(true);
    const doc = document.documentElement;
    const cookieTheme = document.cookie
      .split('; ')
      .find((row) => row.startsWith('payload-theme='))
      ?.split('=')[1];

    const currentTheme =
      cookieTheme ||
      doc.getAttribute('data-theme') ||
      (doc.classList.contains('dark') ? 'dark' : null) ||
      (typeof window !== 'undefined' && localStorage.getItem('theme')) ||
      (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    const resolved = currentTheme === 'light' ? 'light' : 'dark';
    setTheme(resolved);
    doc.setAttribute('data-theme', resolved);
    if (resolved === 'dark') {
      doc.classList.add('dark');
    } else {
      doc.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    const doc = document.documentElement;
    doc.setAttribute('data-theme', nextTheme);
    if (nextTheme === 'dark') {
      doc.classList.add('dark');
    } else {
      doc.classList.remove('dark');
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', nextTheme);
      document.cookie = `payload-theme=${nextTheme}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
      otp: Array(6).fill(''),
    },
    onSubmit: async ({ value }) => {
      setIsPending(true);
      setError(null);

      try {
        const loginData: { email: string; password: string; otp?: string } = {
          email: value.email,
          password: value.password,
        };
        if (step === '2fa') {
          loginData.otp = value.otp.join('');
        }

        const res = await fetch('/api/users/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(loginData),
        });

        const data = await res.json();

        if (!res.ok) {
          // Handle 2FA requirement
          if (
            data.errors?.[0]?.message === '2FA_REQUIRED' ||
            data.message === '2FA_REQUIRED' ||
            (res.status === 401 && data.errors?.some((err: { message: string }) => err.message === '2FA_REQUIRED'))
          ) {
            setStep('2fa');
            setIsPending(false);
            return;
          }

          // Handle specific 2FA errors
          if (data.errors?.[0]?.message === 'INVALID_2FA_CODE') {
            setError('Invalid verification code. Please try again.');
            setIsPending(false);
            return;
          }

          throw new Error(data.errors?.[0]?.message || 'Login failed');
        }

        // Success - Redirect to dashboard
        router.refresh();
        window.location.href = '/admin';
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      } finally {
        setIsPending(false);
      }
    },
  });

  const email = useStore(form.store, (s) => s.values.email);
  const password = useStore(form.store, (s) => s.values.password);
  const otp = useStore(form.store, (s) => s.values.otp);
  const canSubmit = useStore(form.store, (s) => s.canSubmit);

  const isFormValid = step === 'login' ? !!(email.trim() && password.trim()) : otp.every((d) => d.length === 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    form.handleSubmit();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between overflow-y-auto overflow-x-hidden bg-slate-50 dark:bg-[#0b0e17] text-slate-900 dark:text-white transition-colors duration-300">
      {/* Desktop Starry Canvas Background */}
      <div className="hidden md:block pointer-events-none fixed inset-0 -z-10 overflow-hidden [&>canvas]:pointer-events-none [&>canvas]:-z-10">
        <StarryBackground />
      </div>

      {/* Mobile Decorative Orbs Background */}
      <div aria-hidden className="md:hidden pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-24 -right-20 w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/10 blur-3xl" />
        <div className="absolute top-1/3 -left-24 w-64 h-64 rounded-full bg-gradient-to-tr from-cyan-500/20 to-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-16 -right-16 w-80 h-80 rounded-full bg-gradient-to-tl from-purple-500/20 to-blue-500/10 blur-3xl" />
      </div>

      {/* Header with TUWA Logo & docs-ui ThemeSwitcher */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-[var(--tuwa-border-primary)]/10 dark:border-white/[0.04] bg-white/70 dark:bg-[#030303]/40 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl 2xl:max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="https://example.com/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
            <Image
              src="https://cdn.jsdelivr.net/gh/TuwaIO/workflows@main/preview/logo_v2.svg"
              alt="TUWA"
              width={126}
              height={40}
              className="dark:invert transition-opacity duration-300 hover:opacity-80"
              style={{ width: '126px', height: 'auto' }}
              unoptimized
            />
          </a>

          {mounted && <ThemeSwitcher theme={theme} onToggle={toggleTheme} />}
        </div>
      </header>

      {/* Main Authentication Flow matching Client AuthClient */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 pt-20 sm:pt-24 pb-8 w-full my-auto">
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-5xl sm:text-6xl font-mono font-black tracking-tight text-[var(--tuwa-text-primary)] uppercase drop-shadow-sm">
            QUASAR
          </h1>
          <div className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full bg-[var(--tuwa-text-accent)]/10 border border-[var(--tuwa-text-accent)]/20 text-[var(--tuwa-text-accent)] text-xs font-mono font-semibold tracking-wider uppercase">
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            <span>{step === 'login' ? 'Admin Gateway' : 'Security Verification'}</span>
          </div>
        </div>

        <GlassCard
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div className="mb-6 text-center">
            <p className="text-sm text-slate-500 dark:text-gray-400">
              {step === 'login'
                ? 'Enter your administrative credentials to access the Quasar core.'
                : 'Please enter the 6-digit verification code from your authenticator app.'}
            </p>
          </div>

          <ErrorAlert message={error || ''} />

          <form onSubmit={handleSubmit} className="flex flex-col">
            <AnimatePresence mode="wait">
              {step === 'login' ? (
                <motion.div
                  key="login-fields"
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 20, opacity: 0 }}
                  transition={fieldTransition}
                  className="space-y-4"
                >
                  <form.Field
                    name="email"
                    validators={{
                      onChange: ({ value }: { value: string }) => {
                        if (!value.trim()) return UI_TEXT.VALIDATION.REQUIRED;
                        if (!/\S+@\S+\.\S+/.test(value)) return UI_TEXT.VALIDATION.EMAIL_INVALID;
                        return undefined;
                      },
                    }}
                  >
                    {(field) => (
                      <InputField
                        label="Email Address"
                        icon={EnvelopeIcon}
                        type="email"
                        placeholder="admin@example.com"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        errorMessage={
                          field.state.meta.isTouched && field.state.meta.errors.length
                            ? field.state.meta.errors.join(', ')
                            : undefined
                        }
                        autoComplete="email"
                        required
                        autoFocus
                      />
                    )}
                  </form.Field>

                  <form.Field
                    name="password"
                    validators={{
                      onChange: ({ value }: { value: string }) => {
                        if (!value) return UI_TEXT.VALIDATION.REQUIRED;
                        return undefined;
                      },
                    }}
                  >
                    {(field) => (
                      <InputField
                        label="Password"
                        icon={LockClosedIcon}
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••••••"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        trailingIcon={showPassword ? EyeSlashIcon : EyeIcon}
                        onTrailingIconClick={() => setShowPassword(!showPassword)}
                        errorMessage={
                          field.state.meta.isTouched && field.state.meta.errors.length
                            ? field.state.meta.errors.join(', ')
                            : undefined
                        }
                        autoComplete="current-password"
                        required
                      />
                    )}
                  </form.Field>
                </motion.div>
              ) : (
                <motion.div
                  key="2fa-fields"
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  transition={fieldTransition}
                  className="space-y-6"
                >
                  <form.Field name="otp">
                    {(field) => (
                      <TwoFactorInput
                        digits={field.state.value}
                        setDigits={(next) => {
                          field.handleChange(next);
                          setError(null);
                        }}
                        disabled={isPending}
                        autoFocus
                      />
                    )}
                  </form.Field>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('login');
                      form.setFieldValue('otp', Array(6).fill(''));
                    }}
                    className="text-xs text-[var(--tuwa-text-tertiary)] hover:text-[var(--tuwa-text-primary)] transition-colors block mx-auto cursor-pointer font-mono font-medium"
                  >
                    ← Back to credentials
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={!canSubmit || !isFormValid || isPending}
              whileHover={!isPending && canSubmit && isFormValid ? { scale: 1.01 } : {}}
              whileTap={{ scale: 0.98 }}
              style={{ border: 'none', outline: 'none' }}
              className="group mt-6 relative w-full cursor-pointer overflow-hidden rounded-[var(--tuwa-rounded-corners)] bg-[var(--tuwa-text-accent)] px-4 py-3 font-mono font-bold text-[var(--tuwa-text-on-accent)] shadow-md transition-all hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>Processing...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span>{step === 'login' ? 'Authenticate' : 'Verify & Enter'}</span>
                  <ChevronRightIcon className="h-4 w-4 stroke-[2.5] transition-transform group-hover:translate-x-1" />
                </div>
              )}
            </motion.button>
          </form>
        </GlassCard>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200/60 dark:border-white/[0.04] bg-white/40 dark:bg-[#030303]/30 backdrop-blur-sm mt-auto w-full">
        <div className="mx-auto max-w-5xl 2xl:max-w-6xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-zinc-400 font-mono">
          <p className="text-center sm:text-left">
            © 2025–{new Date().getFullYear()} TUWA Ecosystem. Apache-2.0 licensed.
          </p>
          <div className="flex items-center justify-center text-center gap-4">
            <span>Quasar Control Plane • Payload CMS</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
