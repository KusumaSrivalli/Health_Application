import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SymptomStore } from '../src/db/symptomStore.js';

describe('SymptomStore', () => {
  let store;

  beforeEach(() => {
    store = new SymptomStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('stores and retrieves at least 5 logs with unique timestamps for a single patient sorted by timestamp', () => {
    const entries = [
      { symptomDescription: 'Day 3 symptom', severity: 3, timestamp: '2026-11-03T10:00:00.000Z' },
      { symptomDescription: 'Day 1 symptom', severity: 7, timestamp: '2026-11-01T08:00:00.000Z' },
      { symptomDescription: 'Day 5 symptom', severity: 2, timestamp: '2026-11-05T11:00:00.000Z' },
      { symptomDescription: 'Day 2 symptom', severity: 5, timestamp: '2026-11-02T09:00:00.000Z' },
      { symptomDescription: 'Day 4 symptom', severity: 4, timestamp: '2026-11-04T14:00:00.000Z' }
    ];
    for (const entry of entries) {
      store.createLog({ patientId: 'PAT-A', ...entry });
    }
    store.createLog({
      patientId: 'PAT-B',
      symptomDescription: 'Other patient symptom',
      severity: 9,
      timestamp: '2026-11-02T12:00:00.000Z'
    });

    const asc = store.getLogsByPatient('PAT-A', { sort: 'asc' });
    assert.equal(asc.length, 5);
    assert.deepEqual(
      asc.map((l) => l.symptomDescription),
      ['Day 1 symptom', 'Day 2 symptom', 'Day 3 symptom', 'Day 4 symptom', 'Day 5 symptom']
    );

    const desc = store.getLogsByPatient('PAT-A', { sort: 'desc' });
    assert.deepEqual(
      desc.map((l) => l.symptomDescription),
      ['Day 5 symptom', 'Day 4 symptom', 'Day 3 symptom', 'Day 2 symptom', 'Day 1 symptom']
    );

    const page = store.getLogsByPatient('PAT-A', { sort: 'asc', limit: 2, offset: 2 });
    assert.deepEqual(
      page.map((l) => l.symptomDescription),
      ['Day 3 symptom', 'Day 4 symptom']
    );
  });

  it('summarizes distinct patients with counts and average severity', () => {
    store.createLog({
      patientId: 'PAT-A',
      symptomDescription: 'Headache',
      severity: 4,
      timestamp: '2026-11-01T08:00:00.000Z'
    });
    store.createLog({
      patientId: 'PAT-A',
      symptomDescription: 'Migraine',
      severity: 8,
      timestamp: '2026-11-02T08:00:00.000Z'
    });

    const patients = store.listPatients();
    assert.equal(patients.length, 1);
    assert.equal(patients[0].patientId, 'PAT-A');
    assert.equal(patients[0].logCount, 2);
    assert.equal(patients[0].averageSeverity, 6);
    assert.equal(patients[0].latestTimestamp, '2026-11-02T08:00:00.000Z');
  });
});
