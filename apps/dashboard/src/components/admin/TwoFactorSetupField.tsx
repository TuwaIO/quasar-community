'use client';

import {
  ArrowPathIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  KeyIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import { FieldLabel, toast, useField } from '@payloadcms/ui';
import { useState } from 'react';

type Stage = 'idle' | 'enrolling' | 'backup-code' | 'disabling';

/**
 * Replaces the raw `twoFactorEnabled` checkbox with the real TOTP setup
 * flow in Payload Admin.
 *
 * Provides a sleek, high-security dashboard interface matching the Quasar
 * design system:
 * - Real-time status indicators (Active & Enforced vs Disabled)
 * - Contrast-guaranteed QR code container with manual key fallback
 * - Formatted monospace code input with auto-strip whitespace
 * - One-time emergency backup code display with one-click copy
 * - Step-down confirmation modal for disabling 2FA
 */
export function TwoFactorSetupField() {
  const field = useField<boolean>();
  const enabled = Boolean(field.value);

  const [stage, setStage] = useState<Stage>('idle');
  const [loading, setLoading] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [manualSecret, setManualSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualCopied, setManualCopied] = useState(false);

  const reset = () => {
    setStage('idle');
    setLoading(false);
    setQrCodeUrl(null);
    setManualSecret(null);
    setCode('');
  };

  const startEnroll = async () => {
    setLoading(true);
    const toastId = toast.loading('Initializing two-factor enrollment...');
    try {
      const res = await fetch('/api/v1/auth/2fa/generate', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to start 2FA setup.');

      setQrCodeUrl(data.qrCodeUrl);
      setManualSecret(data.secret);
      setStage('enrolling');
      toast.dismiss(toastId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start 2FA setup.', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const confirmEnroll = async () => {
    if (!code) return;
    setLoading(true);
    const toastId = toast.loading('Verifying authenticator code...');
    try {
      const res = await fetch('/api/v1/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Invalid verification code.');

      field.setValue(true);
      setBackupCode(data.backupCode);
      setStage('backup-code');
      toast.success('Two-factor authentication enabled.', { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid verification code.', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const confirmDisable = async () => {
    if (!code) return;
    setLoading(true);
    const toastId = toast.loading('Disabling two-factor authentication...');
    try {
      const res = await fetch('/api/v1/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Invalid verification or backup code.');

      field.setValue(false);
      reset();
      toast.success('Two-factor authentication disabled.', { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid verification or backup code.', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const copyBackupCode = async () => {
    if (!backupCode) return;
    await navigator.clipboard.writeText(backupCode);
    setCopied(true);
    toast.success('Backup code copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const copyManualSecret = async () => {
    if (!manualSecret) return;
    await navigator.clipboard.writeText(manualSecret);
    setManualCopied(true);
    toast.success('Secret key copied to clipboard');
    setTimeout(() => setManualCopied(false), 2000);
  };

  return (
    <div className="field-type text two-factor-setup-field" style={{ marginBottom: '24px' }}>
      <FieldLabel label="Two-Factor Authentication (TOTP)" />

      {stage === 'backup-code' && backupCode ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxWidth: '520px',
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#f59e0b',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <KeyIcon style={{ width: '18px', height: '18px' }} />
            <span>Save Your Emergency Backup Code</span>
          </div>

          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              color: 'var(--theme-text)',
              fontSize: '12px',
              lineHeight: 1.45,
            }}
          >
            <strong>Crucial:</strong> 2FA is now active. Store this backup code in a secure password manager. It is
            shown <strong>only once</strong> and is your only way to regain access if your authenticator device is lost.
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: '8px',
              background: 'var(--theme-elevation-100)',
              border: '1px solid var(--theme-elevation-250)',
            }}
          >
            <code
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '14px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--theme-text)',
                userSelect: 'all',
                wordBreak: 'break-all',
              }}
            >
              {backupCode}
            </code>
            <button
              type="button"
              onClick={copyBackupCode}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                cursor: 'pointer',
                background: copied ? 'rgba(34, 197, 94, 0.15)' : 'var(--theme-elevation-150)',
                border: copied ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid var(--theme-elevation-300)',
                color: copied ? '#22c55e' : 'var(--theme-text)',
                transition: 'all 0.15s ease-in-out',
                flexShrink: 0,
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
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '34px',
                padding: '0 18px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '6px',
                cursor: 'pointer',
                background: '#6366f1',
                color: '#ffffff',
                border: 'none',
                transition: 'all 0.15s ease-in-out',
              }}
            >
              <CheckIcon style={{ width: '15px', height: '15px' }} />
              <span>Done</span>
            </button>
          </div>
        </div>
      ) : stage === 'enrolling' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxWidth: '460px',
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
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
              <QrCodeIcon style={{ width: '17px', height: '17px' }} />
              <span>Set Up Authenticator App</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', fontWeight: 500 }}>Step 1 of 2</span>
          </div>

          <p style={{ margin: 0, fontSize: '12px', color: 'var(--theme-elevation-600)', lineHeight: 1.45 }}>
            Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy, etc.):
          </p>

          <div
            style={{
              alignSelf: 'center',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '12px',
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.06)',
              margin: '4px 0',
            }}
          >
            {qrCodeUrl ? (
              <img alt="2FA QR code" src={qrCodeUrl} style={{ width: '180px', height: '180px', display: 'block' }} />
            ) : (
              <div
                style={{
                  width: '180px',
                  height: '180px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ArrowPathIcon
                  style={{
                    width: '22px',
                    height: '22px',
                    color: '#6366f1',
                    animation: 'quasar-spin 1s linear infinite',
                  }}
                />
              </div>
            )}
          </div>

          {manualSecret && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'var(--theme-elevation-100)',
                border: '1px solid var(--theme-elevation-200)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', fontWeight: 500 }}>
                  Can&apos;t scan? Enter code manually
                </span>
                <button
                  type="button"
                  onClick={copyManualSecret}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: manualCopied ? '#22c55e' : '#6366f1',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {manualCopied ? (
                    <>
                      <CheckIcon style={{ width: '12px', height: '12px' }} />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon style={{ width: '12px', height: '12px' }} />
                      <span>Copy key</span>
                    </>
                  )}
                </button>
              </div>
              <code
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '12px',
                  letterSpacing: '0.08em',
                  color: 'var(--theme-text)',
                  userSelect: 'all',
                  wordBreak: 'break-all',
                }}
              >
                {manualSecret}
              </code>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--theme-text)' }}>
              6-digit code from your app
            </label>
            <input
              autoComplete="one-time-code"
              autoFocus
              maxLength={8}
              onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code) void confirmEnroll();
                if (e.key === 'Escape') reset();
              }}
              placeholder="000 000"
              type="text"
              value={code}
              style={{
                width: '100%',
                height: '40px',
                textAlign: 'center',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '17px',
                fontWeight: 600,
                letterSpacing: '0.25em',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--theme-elevation-300)',
                background: 'var(--theme-elevation-100)',
                color: 'var(--theme-text)',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              disabled={loading || !code}
              onClick={confirmEnroll}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                height: '36px',
                padding: '0 16px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '6px',
                cursor: loading || !code ? 'not-allowed' : 'pointer',
                background: '#6366f1',
                color: '#ffffff',
                border: 'none',
                opacity: loading || !code ? 0.6 : 1,
                transition: 'all 0.15s ease-in-out',
              }}
            >
              {loading ? (
                <>
                  <ArrowPathIcon
                    style={{ width: '14px', height: '14px', animation: 'quasar-spin 1s linear infinite' }}
                  />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <ShieldCheckIcon style={{ width: '15px', height: '15px' }} />
                  <span>Confirm & Enable</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: '36px',
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
      ) : stage === 'disabling' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxWidth: '440px',
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              color: '#ef4444',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <ShieldExclamationIcon style={{ width: '18px', height: '18px' }} />
            <span>Disable Two-Factor Authentication</span>
          </div>

          <p style={{ margin: 0, fontSize: '12px', color: 'var(--theme-elevation-600)', lineHeight: 1.45 }}>
            Enter your current 6-digit authenticator code or emergency backup code to confirm disabling 2FA.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              autoComplete="one-time-code"
              autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code) void confirmDisable();
                if (e.key === 'Escape') reset();
              }}
              placeholder="Authenticator or backup code"
              type="text"
              value={code}
              style={{
                width: '100%',
                height: '40px',
                textAlign: 'center',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '15px',
                fontWeight: 600,
                letterSpacing: '0.15em',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--theme-elevation-300)',
                background: 'var(--theme-elevation-100)',
                color: 'var(--theme-text)',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              disabled={loading || !code}
              onClick={confirmDisable}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                height: '36px',
                padding: '0 16px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '6px',
                cursor: loading || !code ? 'not-allowed' : 'pointer',
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                opacity: loading || !code ? 0.6 : 1,
                transition: 'all 0.15s ease-in-out',
              }}
            >
              {loading ? (
                <>
                  <ArrowPathIcon
                    style={{ width: '14px', height: '14px', animation: 'quasar-spin 1s linear infinite' }}
                  />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Confirm & Disable</span>
              )}
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: '36px',
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
      ) : enabled ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '540px',
            padding: '14px 16px',
            borderRadius: '10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid rgba(34, 197, 94, 0.35)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheckIcon style={{ width: '18px', height: '18px', color: '#22c55e', flexShrink: 0 }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)' }}>TOTP Protection</span>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 9px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '9999px',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                color: '#22c55e',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
              Active & Enforced
            </span>
          </div>

          <p
            style={{ margin: '10px 0 14px 0', fontSize: '12px', color: 'var(--theme-elevation-600)', lineHeight: 1.45 }}
          >
            Two-factor authentication is active on this account. Verification codes are required during sign-in and for
            high-security administrative operations (e.g. revealing application secrets).
          </p>

          <div>
            <button
              type="button"
              onClick={() => {
                setCode('');
                setStage('disabling');
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '32px',
                padding: '0 12px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: '6px',
                cursor: 'pointer',
                background: 'transparent',
                border: '1px solid var(--theme-elevation-300)',
                color: 'var(--theme-text)',
                transition: 'all 0.15s ease-in-out',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                e.currentTarget.style.color = '#ef4444';
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-elevation-300)';
                e.currentTarget.style.color = 'var(--theme-text)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span>Disable 2FA</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '540px',
            padding: '14px 16px',
            borderRadius: '10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid var(--theme-elevation-250)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldExclamationIcon
                style={{ width: '18px', height: '18px', color: 'var(--theme-elevation-500)', flexShrink: 0 }}
              />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)' }}>TOTP Protection</span>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 9px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '9999px',
                background: 'var(--theme-elevation-150)',
                border: '1px solid var(--theme-elevation-300)',
                color: 'var(--theme-elevation-600)',
              }}
            >
              <span
                style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--theme-elevation-400)' }}
              />
              Disabled
            </span>
          </div>

          <p
            style={{ margin: '10px 0 14px 0', fontSize: '12px', color: 'var(--theme-elevation-600)', lineHeight: 1.45 }}
          >
            Protect your admin account with TOTP one-time passwords generated by Google Authenticator, 1Password, or any
            standard authenticator app.
          </p>

          <div>
            <button
              type="button"
              disabled={loading}
              onClick={startEnroll}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                height: '34px',
                padding: '0 14px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                color: 'var(--theme-text)',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.12) 100%)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
                transition: 'all 0.18s ease-in-out',
                opacity: loading ? 0.75 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.65)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(99, 102, 241, 0.25)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.35)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.06)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {loading ? (
                <ArrowPathIcon
                  style={{
                    width: '15px',
                    height: '15px',
                    color: '#6366f1',
                    animation: 'quasar-spin 1s linear infinite',
                  }}
                />
              ) : (
                <ShieldCheckIcon style={{ width: '15px', height: '15px', color: '#6366f1' }} />
              )}
              <span>{loading ? 'Initializing...' : 'Enable 2FA'}</span>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes quasar-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default TwoFactorSetupField;
