import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_SEVERITY,
  MIN_SEVERITY,
  validatePatientId,
  validateSymptomInput
} from '../src/models/symptom.js';

describe('validatePatientId', () => {
  it('accepts valid alphanumeric, dot, underscore, and hyphen IDs', () => {
    const res = validatePatientId('  PAT-101_a.2  ');
    assert.equal(res.valid, true);
    assert.equal(res.value, 'PAT-101_a.2');
  });

  it('rejects empty or non-string patient IDs', () => {
    assert.equal(validatePatientId('').valid, false);
    assert.equal(validatePatientId('   ').valid, false);
    assert.equal(validatePatientId(null).valid, false);
    assert.equal(validatePatientId(123).valid, false);
  });

  it('rejects unsafe characters in patient IDs', () => {
    assert.equal(validatePatientId('../secret').valid, false);
    assert.equal(validatePatientId('PAT 101').valid, false);
  });
});

describe('validateSymptomInput', () => {
  it('validates and normalizes a complete symptom payload', () => {
    const res = validateSymptomInput({
      patientId: ' PAT-101 ',
      symptomDescription: '  Mild headache after lunch  ',
      severity: 4,
      timestamp: '2026-11-25T10:30:00Z'
    });

    assert.equal(res.valid, true);
    assert.deepEqual(res.data, {
      patientId: 'PAT-101',
      symptomDescription: 'Mild headache after lunch',
      severity: 4,
      timestamp: '2026-11-25T10:30:00.000Z'
    });
  });

  it('defaults timestamp to current ISO-8601 string when omitted', () => {
    const before = Date.now();
    const res = validateSymptomInput({
      patientId: 'PAT-101',
      symptomDescription: 'Fatigue',
      severity: 5
    });
    const after = Date.now();

    assert.equal(res.valid, true);
    const parsed = Date.parse(res.data.timestamp);
    assert.ok(parsed >= before && parsed <= after);
  });

  it('accepts boundary severity values 1 and 10', () => {
    const low = validateSymptomInput({
      patientId: 'PAT-1',
      symptomDescription: 'Minimal ache',
      severity: MIN_SEVERITY
    });
    const high = validateSymptomInput({
      patientId: 'PAT-1',
      symptomDescription: 'Extreme pain',
      severity: MAX_SEVERITY
    });

    assert.equal(low.valid, true);
    assert.equal(low.data.severity, 1);
    assert.equal(high.valid, true);
    assert.equal(high.data.severity, 10);
  });

  it('rejects empty or whitespace-only symptom descriptions', () => {
    const res = validateSymptomInput({
      patientId: 'PAT-1',
      symptomDescription: '   \n\t ',
      severity: 5
    });

    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.field === 'symptomDescription'));
  });

  it('rejects descriptions exceeding maximum length', () => {
    const res = validateSymptomInput({
      patientId: 'PAT-1',
      symptomDescription: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1),
      severity: 5
    });

    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.field === 'symptomDescription'));
  });

  it('rejects out-of-range, decimal, and non-numeric severities', () => {
    for (const badSeverity of [0, 11, -3, 5.5, 'abc', '', null, undefined, true]) {
      const res = validateSymptomInput({
        patientId: 'PAT-1',
        symptomDescription: 'Cough',
        severity: badSeverity
      });
      assert.equal(res.valid, false, `Expected severity ${String(badSeverity)} to fail`);
      assert.ok(res.errors.some((e) => e.field === 'severity'));
    }
  });

  it('rejects invalid timestamp formats', () => {
    const res = validateSymptomInput({
      patientId: 'PAT-1',
      symptomDescription: 'Cough',
      severity: 3,
      timestamp: 'not-a-valid-date'
    });

    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.field === 'timestamp'));
  });
});
