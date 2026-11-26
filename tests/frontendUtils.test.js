import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateLast30DaysAverage,
  formatDateTime,
  formatShortDate,
  formatTrendDelta,
  getSeverityInfo,
  toLocalDateTimeInputValue
} from '../public/utils.js';

describe('frontend utils', () => {
  it('maps severity values to Mild, Moderate, and Severe tiers', () => {
    assert.equal(getSeverityInfo(1).label, 'Mild');
    assert.equal(getSeverityInfo(3).label, 'Mild');
    assert.equal(getSeverityInfo(4).label, 'Moderate');
    assert.equal(getSeverityInfo(6).label, 'Moderate');
    assert.equal(getSeverityInfo(7).label, 'Severe');
    assert.equal(getSeverityInfo(10).label, 'Severe');
  });

  it('formats dates and falls back cleanly on invalid inputs', () => {
    assert.equal(formatDateTime('invalid'), 'invalid');
    assert.equal(formatShortDate('invalid'), 'invalid');

    const validIso = '2026-11-26T09:30:00.000Z';
    assert.ok(formatDateTime(validIso).includes('2026'));
    assert.ok(formatShortDate(validIso).length > 0);

    const localStr = toLocalDateTimeInputValue(new Date(2026, 10, 26, 9, 5));
    assert.equal(localStr, '2026-11-26T09:05');
  });

  it('formats trend delta messages accurately', () => {
    assert.equal(formatTrendDelta(0, null), '—');
    assert.equal(formatTrendDelta(1, null), 'Baseline');
    assert.equal(formatTrendDelta(3, -2), 'Improving (-2)');
    assert.equal(formatTrendDelta(3, 3), 'Worsening (+3)');
    assert.equal(formatTrendDelta(3, 0), 'Stable (0)');
  });

  it('aggregates daily averages over the last 30 days and excludes older logs', () => {
    const nowMs = Date.parse('2026-11-26T12:00:00.000Z');
    const logs = [
      { severity: 9, timestamp: '2026-10-01T10:00:00.000Z' },
      { severity: 4, timestamp: '2026-11-24T08:00:00.000Z' },
      { severity: 7, timestamp: '2026-11-24T20:00:00.000Z' },
      { severity: 2, timestamp: '2026-11-26T09:00:00.000Z' }
    ];

    const result = aggregateLast30DaysAverage(logs, nowMs);
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((d) => ({ dayKey: d.dayKey, severity: d.severity, count: d.count })),
      [
        { dayKey: '2026-11-24', severity: 5.5, count: 2 },
        { dayKey: '2026-11-26', severity: 2, count: 1 }
      ]
    );
  });
});
