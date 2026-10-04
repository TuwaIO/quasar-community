'use client';

import { Button } from '@payloadcms/ui';
import { useState } from 'react';

import type { ImportPlan } from '@/lib/cloud-transfer/import/plan';
import type { ImportEvent, ImportReport } from '@/lib/cloud-transfer/import/run';

/**
 * The import flow of `/admin/cloud-import`: file and key → analysis → step-up → import with progress → report.
 * The browser keeps the file and sends it twice, once to analyze and once to import; the node never stores it.
 */

type Step = 'select' | 'review' | 'importing' | 'done';

interface ApiError {
  code?: string;
  error?: string;
  conflicts?: string[];
}

const API = '/api/v1/admin/cloud-import';

const errorOf = async (res: Response): Promise<ApiError> => {
  if (res.status === 413) {
    return {
      code: 'too-large',
      error:
        'The file is larger than the proxy in front of this node accepts (Cloudflare allows 100 MB on its free plan). Raise the upload limit of the proxy and try again.',
    };
  }
  // The node's own errors are JSON; a plain-text 403 comes from a proxy rule in front of it
  const fallback = res.status === 403 ? 'This node does not accept imports.' : `The node answered ${res.status}.`;
  return (await res.json().catch(() => ({ error: fallback }))) as ApiError;
};

/** `1 app`, `4 apps`: the plan and the report count things in English. */
const counted = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function CloudImportWizard() {
  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [key, setKey] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [progress, setProgress] = useState({ transactions: 0, deliveries: 0 });
  const [report, setReport] = useState<ImportReport | null>(null);

  const upload = (path: string, headers: Record<string, string>) =>
    fetch(`${API}/${path}`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': 'application/octet-stream', 'x-qex-key': key, ...headers },
      credentials: 'same-origin',
    });

  const analyze = async () => {
    if (!file || !key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await upload('analyze', {});
      if (!res.ok) {
        setError(await errorOf(res));
        return;
      }
      setPlan(((await res.json()) as { plan: ImportPlan }).plan);
      setStep('review');
    } catch {
      setError({ error: 'The node could not be reached.' });
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const authorized = await fetch(`${API}/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, twoFactorCode: twoFactorCode || undefined }),
        credentials: 'same-origin',
      });
      if (!authorized.ok) {
        setError(await errorOf(authorized));
        return;
      }
      const { importToken } = (await authorized.json()) as { importToken: string };
      setPassword('');
      setTwoFactorCode('');

      const res = await upload('apply', { 'x-import-token': importToken });
      if (!res.ok || !res.body) {
        setError(await errorOf(res));
        return;
      }
      setStep('importing');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as ImportEvent | ({ type: 'error' } & ApiError);
          if (event.type === 'progress')
            setProgress({ transactions: event.transactions, deliveries: event.deliveries });
          if (event.type === 'done') {
            setReport(event.report);
            setStep('done');
          }
          if (event.type === 'error') {
            setError(event);
            setStep('review');
          }
        }
      }
    } catch {
      setError({ error: 'The connection to the node was lost. Run the import again: it continues where it stopped.' });
      setStep('review');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('select');
    setFile(null);
    setKey('');
    setPlan(null);
    setReport(null);
    setError(null);
    setProgress({ transactions: 0, deliveries: 0 });
  };

  const blocked = Boolean(plan?.conflicts.length);

  return (
    <div className="cloud-import">
      {error && (
        <div className="cloud-import__error" role="alert">
          <p>{error.error}</p>
          {error.conflicts?.map((conflict) => (
            <p key={conflict}>{conflict}</p>
          ))}
        </div>
      )}

      {step === 'select' && (
        <section className="cloud-import__section">
          <p>
            In Quasar Cloud, open the organization and choose <strong>Export Organization</strong>. Upload the
            <code> .qex</code> file here with the import key that Cloud showed once.
          </p>
          <div className="cloud-import__field">
            <span>Export file</span>
            <label
              className={[
                'cloud-import__dropzone',
                dragging && 'cloud-import__dropzone--active',
                file && 'cloud-import__dropzone--selected',
              ]
                .filter(Boolean)
                .join(' ')}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                setFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <input
                type="file"
                accept=".qex"
                className="cloud-import__file-input"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <strong className="cloud-import__dropzone-title">{file.name}</strong>
                  <span className="cloud-import__dropzone-hint">{fileSize(file.size)} · choose another file</span>
                </>
              ) : (
                <>
                  <strong className="cloud-import__dropzone-title">Choose the .qex file</strong>
                  <span className="cloud-import__dropzone-hint">or drop it here</span>
                </>
              )}
            </label>
          </div>
          <label className="cloud-import__field">
            <span>Import key</span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="QEX1-XXXX-XXXX-…"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <Button onClick={analyze} disabled={!file || !key.trim() || busy}>
            {busy ? 'Reading the export…' : 'Analyze'}
          </Button>
        </section>
      )}

      {step === 'review' && plan && (
        <section className="cloud-import__section">
          <h2>{plan.organization.name}</h2>
          <p>
            {plan.organization.mode === 'new'
              ? 'A new organization will be created on this node, with the same id as in Quasar Cloud.'
              : 'This organization is already on this node: the import adds what is new and updates transactions that changed in Cloud. Settings changed on this node are kept.'}{' '}
            Exported {new Date(plan.exportedAt).toLocaleString()}.
          </p>
          <ul>
            <li>
              {counted(plan.counts.app, 'app')}, {counted(plan.counts.webhookEndpoint, 'webhook endpoint')}
            </li>
            <li>{counted(plan.counts.transaction, 'transaction')}</li>
            <li>
              {counted(plan.counts.webhookDelivery, 'webhook delivery', 'webhook deliveries')} since{' '}
              {new Date(plan.deliveriesSince).toLocaleDateString()}
            </li>
            {plan.counts.appAcceptedPayment + plan.counts.appInvoice > 0 && (
              <li>
                {counted(plan.counts.appAcceptedPayment, 'accepted payment')} and{' '}
                {counted(plan.counts.appInvoice, 'invoice')} of the Payments App
              </li>
            )}
            {plan.members > 0 && (
              <li>
                {counted(plan.members, 'Cloud member')} {plan.members === 1 ? 'is' : 'are'} not imported: this node has
                one admin, who becomes the owner.
              </li>
            )}
          </ul>

          <h3>Apps</h3>
          <ul>
            {plan.apps.map((app) => (
              <li key={app.id}>
                {app.name}: {app.action === 'create' ? 'will be created with its Cloud API keys' : 'already here, kept'}
                {app.skippedRpcConfigs.map((rpc) => (
                  <span key={rpc.chainId}>
                    ; RPC override for chain {rpc.chainId} left out ({rpc.reason})
                  </span>
                ))}
                {app.quickNodeSkipped && <span>; QuickNode endpoint left out ({app.quickNodeSkipped})</span>}
              </li>
            ))}
          </ul>

          <h3>Webhook endpoints</h3>
          {plan.endpoints.length === 0 && (
            <p className="cloud-import__muted">
              None in this export. System webhooks, which Quasar Cloud uses for its own billing, are never exported.
            </p>
          )}
          <ul>
            {plan.endpoints.map((endpoint) => (
              <li key={endpoint.id}>
                {endpoint.url}:{' '}
                {endpoint.action === 'create'
                  ? 'will be created with its signing secret'
                  : endpoint.action === 'keep'
                    ? 'already here, kept'
                    : `left out (${endpoint.reason})`}
              </li>
            ))}
          </ul>

          {blocked ? (
            <div className="cloud-import__error">
              <p>The export collides with data on this node, so nothing will be imported:</p>
              {plan.conflicts.map((conflict) => (
                <p key={conflict}>{conflict}</p>
              ))}
            </div>
          ) : (
            <>
              <h3>Confirm</h3>
              <p>The import creates API keys on this node. Confirm it with your password.</p>
              <label className="cloud-import__field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="cloud-import__field">
                <span>Two-factor code (if two-factor authentication is on)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value)}
                />
              </label>
              <Button onClick={runImport} disabled={!password || busy}>
                {busy ? 'Starting…' : 'Import'}
              </Button>
            </>
          )}
          <Button buttonStyle="secondary" onClick={reset} disabled={busy}>
            Choose another file
          </Button>
        </section>
      )}

      {step === 'importing' && plan && (
        <section className="cloud-import__section">
          <p>Importing {plan.organization.name}…</p>
          <progress
            max={Math.max(plan.counts.transaction + plan.counts.webhookDelivery, 1)}
            value={progress.transactions + progress.deliveries}
          />
          <p>
            {progress.transactions} of {plan.counts.transaction} transactions, {progress.deliveries} of{' '}
            {plan.counts.webhookDelivery} deliveries
          </p>
        </section>
      )}

      {step === 'done' && report && (
        <section className="cloud-import__section">
          <h2>{report.plan.organization.name} is on this node</h2>
          <ul>
            <li>
              Transactions: {report.transactions.inserted} added, {report.transactions.updated} updated,{' '}
              {report.transactions.unchanged} already up to date
            </li>
            <li>
              Webhook deliveries: {report.deliveries.inserted} added, {report.deliveries.unchanged} already here
              {report.deliveries.skipped > 0 && `, ${report.deliveries.skipped} of left-out endpoints not imported`}
            </li>
            <li>{report.queued} transactions that were still pending are now tracked by this node</li>
          </ul>
          <p>
            Point your apps at this node: set <code>baseUrl</code> of <code>@tuwaio/quasar-sdk</code> to its Engine URL.
            The API keys and webhook signing secrets are the same as in Quasar Cloud. Import a fresh export once more
            after the switch to bring over what happened in Cloud meanwhile, then deactivate the apps there.
          </p>
          <Button onClick={reset}>Done</Button>
        </section>
      )}
    </div>
  );
}
