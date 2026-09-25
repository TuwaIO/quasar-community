/**
 * Universal timestamp formatter for the Quasar dashboard.
 *
 * Handles both seconds-based and milliseconds-based Unix timestamps.
 * All transaction timestamps from Pulsar can arrive in either format,
 * so we normalise using the 1e12 threshold heuristic.
 */

/**
 * Format a raw timestamp into a human-readable locale string.
 * Returns '—' for falsy / unparseable inputs.
 */
export function formatTimestamp(ts: number | string | null | undefined): string {
  if (!ts) return '—';

  // Try to parse ISO string first
  if (typeof ts === 'string' && ts.includes('-') && ts.includes('T')) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }

  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (Number.isNaN(n) || n === 0) return '—';
  const d = n > 1e12 ? new Date(n) : new Date(n * 1000);
  return d.toLocaleString();
}

/**
 * Format a raw timestamp into a compact display string (HH:mm, MMM DD, YYYY).
 * Used in table rows where space is limited.
 */
export function formatTimestampShort(ts: number | string | null | undefined): string {
  if (!ts) return '—';

  let d: Date;

  // Try to parse ISO string first
  if (typeof ts === 'string' && ts.includes('-') && ts.includes('T')) {
    d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
  } else {
    const n = typeof ts === 'string' ? Number(ts) : ts;
    if (Number.isNaN(n) || n === 0) return '—';
    d = n > 1e12 ? new Date(n) : new Date(n * 1000);
  }

  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${hh}:${mm}, ${months[d.getMonth()]} ${d.getDate().toString().padStart(2, '0')}, ${d.getFullYear()}`;
}

/**
 * Format a raw timestamp into an ISO 8601 string.
 * Used in CSV exports and machine-readable contexts.
 */
export function formatTimestampISO(ts: number | string | null | undefined): string {
  if (!ts) return '';
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (Number.isNaN(n) || n === 0) return '';
  return (n > 1e12 ? new Date(n) : new Date(n * 1000)).toISOString();
}
