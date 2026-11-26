/**
 * Pure formatting and aggregation utilities shared by HealthTrack frontend and unit tests.
 */

export function getSeverityInfo(severity) {
  if (severity <= 3) return { label: 'Mild', className: 'severity-mild', color: '#15803d' };
  if (severity <= 6) return { label: 'Moderate', className: 'severity-moderate', color: '#d97706' };
  return { label: 'Severe', className: 'severity-severe', color: '#dc2626' };
}

export function formatDateTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatShortDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function toLocalDateTimeInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatTrendDelta(totalCount, recentDelta) {
  if (!totalCount || totalCount === 0) return '—';
  if (totalCount === 1 || recentDelta === null || recentDelta === undefined) return 'Baseline';
  if (recentDelta < 0) return `Improving (${recentDelta})`;
  if (recentDelta > 0) return `Worsening (+${recentDelta})`;
  return 'Stable (0)';
}

export function aggregateLast30DaysAverage(logs, nowMs = Date.now()) {
  const cutoffMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  const recent = logs.filter((log) => {
    const ms = Date.parse(log.timestamp);
    return !Number.isNaN(ms) && ms >= cutoffMs && ms <= nowMs + 60_000;
  });

  const byDay = new Map();
  for (const log of recent) {
    const d = new Date(log.timestamp);
    const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, { dayKey, timestamp: log.timestamp, sum: 0, count: 0 });
    }
    const bucket = byDay.get(dayKey);
    bucket.sum += log.severity;
    bucket.count += 1;
    if (log.timestamp > bucket.timestamp) {
      bucket.timestamp = log.timestamp;
    }
  }

  return Array.from(byDay.values())
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map((bucket) => ({
      dayKey: bucket.dayKey,
      timestamp: bucket.timestamp,
      severity: Number((bucket.sum / bucket.count).toFixed(1)),
      count: bucket.count
    }));
}
