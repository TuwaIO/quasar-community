import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';
import { APIError, ValidationError } from 'payload';

import { isAdmin } from '@/lib/access';

/** Where a review stands: the collector fills it during its week, then it waits for an admin to confirm it. */
export const REVIEW_STATUS = { COLLECTING: 'collecting', READY: 'ready', CONFIRMED: 'confirmed' } as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];

/**
 * The reasons an admin gives for an SSH session: each one of the four the DPA and the transfer assessment name for SSH
 * access to the servers (deployments and migrations, backups and restores, incidents, work the admin panel cannot do),
 * the label saying which. A session for another reason is not authorized.
 */
export const SESSION_REASONS = [
  { value: 'migration', label: 'Deployment or migration: a release, a database migration' },
  { value: 'config', label: 'Deployment: configuration (.env, secrets, keys)' },
  { value: 'restore', label: 'Backup or restore' },
  { value: 'incident', label: 'Incident: an outage, an alert, its investigation' },
  { value: 'server_update', label: 'Work the admin panel cannot do: server or Docker update, restart' },
  { value: 'checks', label: 'Work the admin panel cannot do: logs, containers, disk' },
  { value: 'admin_cannot', label: 'Work the admin panel cannot do: something else (say what)' },
] as const;

/** The reason that needs what was done in the session. */
const OTHER_WORK = 'admin_cannot';

/** `Oct 20, 09:00 UTC`: when a session started, as an error names it. */
const sessionTime = (iso?: string | null) =>
  iso
    ? `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ` +
      `${new Date(iso).toISOString().slice(11, 16)} UTC`
    : 'no time';

/** The context flag of the writes of the collector, which bypass the rules for an admin. */
export const SYSTEM_CONTEXT = 'accessReviewSystem';

interface Session {
  id?: string | null;
  startedAt?: string | null;
  user?: string | null;
  method?: string | null;
  keyFingerprint?: string | null;
  connection?: string | null;
  auto?: boolean | null;
  reason?: string | null;
  work?: string | null;
  readData?: string | null;
}

interface Review {
  status?: ReviewStatus | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  serverSessions?: Session[] | null;
  findings?: unknown[] | null;
  collected?: unknown;
  collectedUntil?: string | null;
  result?: string | null;
  confirmed?: boolean | null;
  reviewer?: unknown;
  reviewerEmail?: string | null;
  reviewedAt?: string | null;
}

/**
 * The rules of a change of a review (the `beforeChange` hook):
 * - the collector (`req.context[SYSTEM_CONTEXT]`) creates and fills drafts, but never confirms one;
 * - an admin records a review by hand at once, or completes a draft: the reason and the data read of each SSH session,
 *   the result, the confirmation; what the collector gathered and its sessions stay as they were;
 * - confirming needs the result and a reason and the data read for every session (and what was done, for other work the
 *   admin panel cannot do), and records who confirmed and when;
 * - a confirmed review never changes.
 *
 * @returns The data to store.
 * @throws APIError 400 or 403 for a change the rules refuse; ValidationError naming each field a confirmation misses.
 */
export function reviewChange(params: {
  operation: 'create' | 'update';
  data: Review;
  original?: Review | null;
  user?: { id: string; email?: string } | null;
  system: boolean;
  now?: Date;
}): Review {
  const { operation, data, original, user, system } = params;
  const now = (params.now ?? new Date()).toISOString();
  if (original?.status === REVIEW_STATUS.CONFIRMED) throw new APIError('A confirmed review cannot be changed.', 400);
  const from = data.periodFrom ?? original?.periodFrom;
  const to = data.periodTo ?? original?.periodTo;
  if (from && to && Date.parse(from) > Date.parse(to)) throw new APIError('The period ends before it starts.', 400);

  if (system) {
    if (data.status === REVIEW_STATUS.CONFIRMED || data.confirmed) {
      throw new APIError('Only an admin confirms a review.', 400);
    }
    return { ...data, status: data.status ?? original?.status ?? REVIEW_STATUS.COLLECTING, confirmed: false };
  }
  if (!user) throw new APIError('Sign in to record a review.', 403);

  // What the collector gathered is not the admin's to change: its sessions keep their time, user and key
  const sessions = (() => {
    const incoming = data.serverSessions ?? original?.serverSessions ?? [];
    const auto = (original?.serverSessions ?? []).filter((s) => s.auto);
    const byId = new Map(incoming.filter((s) => s.id).map((s) => [s.id, s]));
    const kept = auto.map((s) => ({
      ...s,
      reason: byId.get(s.id)?.reason ?? s.reason ?? null,
      work: byId.get(s.id)?.work ?? s.work ?? null,
      readData: byId.get(s.id)?.readData ?? s.readData ?? null,
    }));
    const autoIds = new Set(auto.map((s) => s.id));
    const added = incoming.filter((s) => !s.id || !autoIds.has(s.id)).map((s) => ({ ...s, auto: false }));
    return [...kept, ...added];
  })();
  const next: Review = {
    ...data,
    serverSessions: sessions,
    ...(original
      ? {
          periodFrom: original.periodFrom,
          periodTo: original.periodTo,
          findings: original.findings,
          collected: original.collected,
          collectedUntil: original.collectedUntil,
        }
      : {}),
  };

  // A review recorded by hand is confirmed at once; a draft is confirmed when the admin ticks the confirmation
  const confirming = operation === 'create' || data.confirmed === true;
  if (!confirming) return { ...next, status: original?.status ?? REVIEW_STATUS.READY, confirmed: false };
  if (data.confirmed !== true) throw new APIError('Confirm that you reviewed the records of this period.', 400);
  // Every missing field at once, by its path, so the admin panel marks each one and the message names the session
  const missing: { path: string; label: string; message: string }[] = [];
  if (!(data.result ?? original?.result)?.trim()) {
    missing.push({ path: 'result', label: 'Result', message: 'Write the result of the review.' });
  }
  sessions.forEach((s, i) => {
    const name = `SSH session ${i + 1} (${sessionTime(s.startedAt)}, ${s.user || 'unknown user'})`;
    if (!s.reason) {
      missing.push({ path: `serverSessions.${i}.reason`, label: `${name}: Reason`, message: 'Choose the reason.' });
    }
    if (s.reason === OTHER_WORK && !s.work?.trim()) {
      missing.push({ path: `serverSessions.${i}.work`, label: `${name}: What you did`, message: 'Say what you did.' });
    }
    if (!s.readData?.trim()) {
      missing.push({
        path: `serverSessions.${i}.readData`,
        label: `${name}: Customer data read`,
        message: 'Write which customer data you read or changed, or "none".',
      });
    }
  });
  if (missing.length > 0) throw new ValidationError({ errors: missing });
  // A draft confirmed before its week ends covers what the collector gathered so far; the next draft starts there
  const early =
    original?.status === REVIEW_STATUS.COLLECTING &&
    original.periodTo &&
    Date.parse(original.periodTo) > Date.parse(now)
      ? { periodTo: original.collectedUntil ?? now }
      : {};
  return {
    ...next,
    ...early,
    status: REVIEW_STATUS.CONFIRMED,
    confirmed: true,
    reviewer: user.id,
    reviewerEmail: user.email ?? '',
    reviewedAt: now,
  };
}

const readOnly = { readOnly: true } as const;
/** Whether a review is confirmed: who confirmed it and when show only then. */
const isConfirmed = (data: Partial<Review> | undefined) => data?.status === REVIEW_STATUS.CONFIRMED;

/**
 * The weekly review of the operator's access to customer data. A collector fills a draft for each week: the views in
 * the data access log, the requests to the admin panel in the log of the reverse proxy, which keeps 7 days, and each
 * SSH session of the servers, and it alerts at once to a sign-in or a view it does not expect. An admin then gives the
 * reason and the data read of each SSH session, writes the result and confirms the review; a confirmed review never
 * changes. A review can also be recorded by hand. The server deletes reviews after 3 years
 * (`RETENTION.ACCESS_REVIEW_MONTHS`).
 */
export const AccessReviews: CollectionConfig = {
  slug: 'access-reviews',
  disableDuplicate: true,
  defaultSort: '-periodFrom',
  admin: {
    group: 'Audit',
    useAsTitle: 'periodFrom',
    defaultColumns: ['periodFrom', 'periodTo', 'status', 'reviewerEmail', 'reviewedAt'],
    description:
      'Every week: open the review of the week, give the reason of each SSH session and what you read, check the ' +
      'findings, write the result and confirm. A confirmed review cannot be changed.',
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    // A confirmed review is read-only in the admin panel too (the hook refuses the change in any case)
    update: (args) => (isAdmin(args) ? { status: { not_equals: REVIEW_STATUS.CONFIRMED } } : false),
    delete: () => false,
  },
  hooks: {
    beforeChange: [
      ({ operation, data, originalDoc, req }) =>
        reviewChange({
          operation: operation === 'create' ? 'create' : 'update',
          data: data as Review,
          original: (originalDoc as Review | undefined) ?? null,
          user: req.user ? { id: String(req.user.id), email: (req.user as { email?: string }).email } : null,
          system: req.context?.[SYSTEM_CONTEXT] === true,
        }),
    ],
  },
  fields: [
    { name: 'id', type: 'text', unique: true, required: true, defaultValue: () => createId(), admin: { hidden: true } },
    { name: 'periodFrom', type: 'date', required: true, index: true },
    { name: 'periodTo', type: 'date', required: true },
    {
      name: 'status',
      type: 'select',
      index: true,
      defaultValue: REVIEW_STATUS.CONFIRMED,
      options: [
        { value: REVIEW_STATUS.COLLECTING, label: 'Collecting' },
        { value: REVIEW_STATUS.READY, label: 'Ready to confirm' },
        { value: REVIEW_STATUS.CONFIRMED, label: 'Confirmed' },
      ],
      admin: { ...readOnly, position: 'sidebar' },
    },
    {
      name: 'sources',
      type: 'text',
      defaultValue: 'Data Access Log · SSH sign-ins of the servers · reverse-proxy log (7 days)',
    },
    {
      name: 'findings',
      type: 'array',
      admin: {
        ...readOnly,
        description: 'What the collector did not expect. Explain each finding in the result before you confirm.',
      },
      fields: [
        { name: 'at', type: 'date', admin: { ...readOnly, date: { pickerAppearance: 'dayAndTime' } } },
        {
          name: 'severity',
          type: 'select',
          options: [
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
          ],
          admin: readOnly,
        },
        { name: 'rule', type: 'text', admin: readOnly },
        { name: 'detail', type: 'textarea', admin: readOnly },
      ],
    },
    {
      name: 'serverSessions',
      type: 'array',
      admin: {
        description:
          'Each SSH session of the period: the collector fills when, who and with which key; you give the reason and ' +
          'what you read. A session for another reason is not authorized: write in the result what happened and what ' +
          'you did about it.',
      },
      fields: [
        {
          name: 'startedAt',
          type: 'date',
          required: true,
          admin: { date: { pickerAppearance: 'dayAndTime' } },
        },
        { name: 'user', type: 'text', admin: readOnly },
        { name: 'method', type: 'text', admin: readOnly },
        { name: 'keyFingerprint', type: 'text', admin: readOnly },
        // The client address and port of the sign-in as a short hash (`connectionId`): the answer of its sign-in prompt
        // finds the session by it, and the review keeps no address
        { name: 'connection', type: 'text', admin: { hidden: true } },
        { name: 'auto', type: 'checkbox', defaultValue: false, admin: { hidden: true } },
        {
          name: 'reason',
          type: 'select',
          options: [...SESSION_REASONS],
          admin: {
            description: 'A session filled in advance (a deployment, a sign-in answer) still needs your check.',
          },
        },
        {
          name: 'work',
          type: 'textarea',
          label: 'What you did',
          admin: {
            description:
              'In a few words, e.g. "Changed RESEND_API_KEY in .env and restarted the dashboard", "apt upgrade and ' +
              'reboot", "Read the engine logs after the Redis alert". Needed for "something else".',
          },
        },
        {
          name: 'readData',
          type: 'textarea',
          label: 'Customer data read',
          admin: {
            description:
              'Which customer data you read or changed (tables, records and why), or "none" when you did not open the ' +
              'database or read no customer record.',
          },
        },
      ],
    },
    {
      name: 'collected',
      type: 'json',
      admin: { ...readOnly, description: 'What the collector counted on each day of the period.' },
    },
    { name: 'collectedUntil', type: 'date', admin: { ...readOnly, date: { pickerAppearance: 'dayAndTime' } } },
    {
      name: 'result',
      type: 'textarea',
      admin: {
        description:
          'Who viewed what and why; anything unexplained and what you did about it. E.g. "All views of customer data ' +
          'were mine, for support of org X (ticket 12). SSH: 12 automated deployments and 1 .env change, all mine; no ' +
          'customer data read. Finding: the unknown key was the new deploy key, now listed. Nothing unexplained."',
      },
    },
    {
      name: 'confirmed',
      type: 'checkbox',
      label: 'I reviewed the records of this period.',
      admin: {
        description:
          'Tick and save: the review is confirmed and can no longer change; your account, your email and the time are ' +
          'recorded below.',
      },
    },
    // Filled when the review is saved with the confirmation ticked (reviewChange); empty until then, so hidden
    { name: 'reviewer', type: 'relationship', relationTo: 'users', admin: { ...readOnly, condition: isConfirmed } },
    { name: 'reviewerEmail', type: 'text', admin: { ...readOnly, condition: isConfirmed } },
    {
      name: 'reviewedAt',
      type: 'date',
      index: true,
      admin: { ...readOnly, condition: isConfirmed, date: { pickerAppearance: 'dayAndTime' } },
    },
  ],
};
