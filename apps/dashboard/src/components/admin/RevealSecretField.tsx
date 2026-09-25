'use client';

import {
  CheckIcon,
  ClipboardDocumentIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { FieldLabel, toast } from '@payloadcms/ui';
import { useState } from 'react';

export interface RevealSecretFieldProps {
  label: string;
  /**
   * Resolves the reveal endpoint URL right before the request is made.
   */
  resolveRevealUrl: () => Promise<string>;
  /** Key in the reveal endpoint's JSON response that holds the raw secret. */
  responseKey: string;
}

/**
 * High-grade step-up-auth reveal widget for sensitive credentials (sk_live_..., whsec_...).
 * Provides a masked state with an eye icon, an authenticated step-up panel,
 * and a secure monospace display with one-click copy and hide actions.
 */
export function RevealSecretField({ label, resolveRevealUrl, responseKey }: RevealSecretFieldProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setOpen(false);
    setSecret(null);
    setPassword('');
    setTwoFactorCode('');
    setError(null);
    setCopied(false);
  };

  const reveal = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    const toastId = toast.loading('Verifying credentials...');

    try {
      const url = await resolveRevealUrl();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password, twoFactorCode: twoFactorCode || undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to reveal secret.');
      }

      setSecret(data[responseKey]);
      setOpen(false);
      setPassword('');
      setTwoFactorCode('');
      toast.success(`${label} revealed`, { id: toastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reveal secret.';
      setError(msg);
      toast.error(msg, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="field-type text secret-field" style={{ marginBottom: '20px' }}>
      <FieldLabel label={label} />

      {secret ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '14px 16px',
            borderRadius: '10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#6366f1',
              }}
            >
              <KeyIcon style={{ width: '15px', height: '15px' }} />
              <span>Decrypted Secret</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={copy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: copied ? 'rgba(34, 197, 94, 0.15)' : 'var(--theme-elevation-150)',
                  border: copied ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid var(--theme-elevation-300)',
                  color: copied ? '#22c55e' : 'var(--theme-text)',
                  transition: 'all 0.15s ease-in-out',
                }}
              >
                {copied ? (
                  <>
                    <CheckIcon style={{ width: '13px', height: '13px' }} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <ClipboardDocumentIcon style={{ width: '13px', height: '13px' }} />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={reset}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  fontWeight: 500,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: 'transparent',
                  border: '1px solid var(--theme-elevation-250)',
                  color: 'var(--theme-text)',
                  opacity: 0.8,
                }}
              >
                <EyeSlashIcon style={{ width: '13px', height: '13px' }} />
                <span>Hide</span>
              </button>
            </div>
          </div>
          <code
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '13px',
              lineHeight: 1.5,
              wordBreak: 'break-all',
              userSelect: 'all',
              color: 'var(--theme-text)',
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'var(--theme-elevation-100)',
              border: '1px solid var(--theme-elevation-200)',
            }}
          >
            {secret}
          </code>
        </div>
      ) : open ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxWidth: '440px',
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              color: '#6366f1',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <LockClosedIcon style={{ width: '16px', height: '16px' }} />
            <span>Verify Password to Reveal {label}</span>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--theme-elevation-600)', lineHeight: 1.4 }}>
            This action requires step-up authentication. Enter your admin account password to decrypt.
          </p>

          <input
            autoComplete="current-password"
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password) void reveal();
              if (e.key === 'Escape') reset();
            }}
            placeholder="Account password"
            type="password"
            value={password}
            style={{
              width: '100%',
              height: '38px',
              padding: '0 12px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid var(--theme-elevation-300)',
              background: 'var(--theme-elevation-100)',
              color: 'var(--theme-text)',
              outline: 'none',
            }}
          />

          <input
            autoComplete="one-time-code"
            onChange={(e) => setTwoFactorCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password) void reveal();
              if (e.key === 'Escape') reset();
            }}
            placeholder="2FA code (if 2FA enabled on account)"
            type="text"
            value={twoFactorCode}
            style={{
              width: '100%',
              height: '38px',
              padding: '0 12px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid var(--theme-elevation-300)',
              background: 'var(--theme-elevation-100)',
              color: 'var(--theme-text)',
              outline: 'none',
            }}
          />

          {error && <div style={{ fontSize: '12px', color: 'var(--theme-error-500)', fontWeight: 500 }}>{error}</div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              disabled={loading || !password}
              onClick={reveal}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '34px',
                padding: '0 16px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '6px',
                cursor: loading || !password ? 'not-allowed' : 'pointer',
                background: '#6366f1',
                color: '#ffffff',
                border: 'none',
                opacity: loading || !password ? 0.6 : 1,
                transition: 'all 0.15s ease-in-out',
              }}
            >
              {loading ? 'Verifying...' : 'Confirm & Reveal'}
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: '34px',
                padding: '0 14px',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '6px',
                cursor: 'pointer',
                background: 'transparent',
                border: '1px solid var(--theme-elevation-300)',
                color: 'var(--theme-text)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            maxWidth: '540px',
            padding: '6px 10px',
            borderRadius: '8px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid var(--theme-elevation-250)',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <LockClosedIcon
              style={{ width: '16px', height: '16px', color: 'var(--theme-elevation-500)', flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '13px',
                letterSpacing: '0.18em',
                color: 'var(--theme-elevation-500)',
                userSelect: 'none',
              }}
            >
              ••••••••••••••••••••••••••••••••
            </span>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              height: '30px',
              padding: '0 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              cursor: 'pointer',
              color: 'var(--theme-text)',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.12) 100%)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              transition: 'all 0.15s ease-in-out',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.65)';
              e.currentTarget.style.boxShadow = '0 0 10px rgba(99, 102, 241, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.35)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <EyeIcon style={{ width: '14px', height: '14px', color: '#6366f1' }} />
            <span>Show {label.toLowerCase()}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default RevealSecretField;
