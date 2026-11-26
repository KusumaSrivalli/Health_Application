import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestHandler } from '../src/app.js';
import { SymptomStore } from '../src/db/symptomStore.js';
import { inject } from './helpers/inject.js';

describe('HealthTrack HTTP API', () => {
  let store;
  let handler;

  beforeEach(() => {
    store = new SymptomStore(':memory:');
    handler = createRequestHandler({ store });
  });

  afterEach(() => {
    store.close();
  });

  it('GET /api/health returns ok status and strict security headers', async () => {
    const res = await inject(handler, { method: 'GET', url: '/api/health' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(res.headers['content-security-policy']);
    assert.ok(!res.headers['content-security-policy'].includes("'unsafe-inline'"));
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.ok(body.timestamp);
  });

  it('GET /api/config returns shared validation constants', async () => {
    const res = await inject(handler, { method: 'GET', url: '/api/config' });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.minSeverity, 1);
    assert.equal(body.maxSeverity, 10);
    assert.equal(body.maxDescriptionLength, 500);
  });

  it('POST /api/symptoms creates a log and GET /api/symptoms/:patientId returns sorted logs', async () => {
    const first = await inject(handler, {
      method: 'POST',
      url: '/api/symptoms',
      headers: { 'content-type': 'application/json' },
      body: {
        patientId: 'PAT-200',
        symptomDescription: 'Evening fever',
        severity: 7,
        timestamp: '2026-11-25T20:00:00.000Z'
      }
    });
    assert.equal(first.status, 201);
    const firstBody = first.json();
    assert.equal(firstBody.message, 'Symptom log created successfully.');
    assert.equal(firstBody.log.patientId, 'PAT-200');
    assert.equal(firstBody.log.severity, 7);

    const second = await inject(handler, {
      method: 'POST',
      url: '/api/symptoms',
      headers: { 'content-type': 'application/json' },
      body: {
        patientId: 'PAT-200',
        symptomDescription: 'Morning chills',
        severity: 4,
        timestamp: '2026-11-25T08:00:00.000Z'
      }
    });
    assert.equal(second.status, 201);

    const listDefault = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/PAT-200'
    });
    assert.equal(listDefault.status, 200);
    const defaultBody = listDefault.json();
    assert.equal(defaultBody.sort, 'asc');
    assert.equal(defaultBody.count, 2);
    assert.deepEqual(
      defaultBody.logs.map((l) => l.symptomDescription),
      ['Morning chills', 'Evening fever']
    );

    const listDesc = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/PAT-200?sort=desc&limit=1&offset=0'
    });
    assert.equal(listDesc.status, 200);
    const descBody = listDesc.json();
    assert.equal(descBody.count, 1);
    assert.deepEqual(
      descBody.logs.map((l) => l.symptomDescription),
      ['Evening fever']
    );
  });

  it('POST /api/symptoms returns 400 with field details on invalid input', async () => {
    const res = await inject(handler, {
      method: 'POST',
      url: '/api/symptoms',
      headers: { 'content-type': 'application/json' },
      body: {
        patientId: 'PAT-200',
        symptomDescription: '   ',
        severity: 12
      }
    });

    assert.equal(res.status, 400);
    const body = res.json();
    assert.equal(body.error, 'Validation failed.');
    assert.ok(body.details.some((d) => d.field === 'symptomDescription'));
    assert.ok(body.details.some((d) => d.field === 'severity'));
  });

  it('POST /api/symptoms returns 400 on malformed JSON and 413 on oversize body', async () => {
    const badJson = await inject(handler, {
      method: 'POST',
      url: '/api/symptoms',
      headers: { 'content-type': 'application/json' },
      body: '{bad json'
    });
    assert.equal(badJson.status, 400);
    assert.match(badJson.json().error, /Invalid JSON/);

    const oversize = await inject(handler, {
      method: 'POST',
      url: '/api/symptoms',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patientId: 'PAT-1',
        symptomDescription: 'x'.repeat(17 * 1024),
        severity: 5
      })
    });
    assert.equal(oversize.status, 413);
  });

  it('GET /api/symptoms/:patientId handles malformed encoding, unknown patients, and invalid query params', async () => {
    const malformed = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/%E0%A4%A'
    });
    assert.equal(malformed.status, 400);

    const emptyRes = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/PAT-UNKNOWN'
    });
    assert.equal(emptyRes.status, 200);
    const emptyBody = emptyRes.json();
    assert.equal(emptyBody.count, 0);
    assert.deepEqual(emptyBody.logs, []);

    const badSort = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/PAT-UNKNOWN?sort=random'
    });
    assert.equal(badSort.status, 400);

    const badLimit = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/PAT-UNKNOWN?limit=0'
    });
    assert.equal(badLimit.status, 400);
  });

  it('GET /api/patients returns patient summary list', async () => {
    await inject(handler, {
      method: 'POST',
      url: '/api/symptoms',
      body: { patientId: 'PAT-300', symptomDescription: 'Cough', severity: 3 }
    });
    const res = await inject(handler, { method: 'GET', url: '/api/patients' });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.patients.length, 1);
    assert.equal(body.patients[0].patientId, 'PAT-300');
  });

  it('serves static index.html, blocks traversal, and returns 404 for unknown API routes', async () => {
    const htmlRes = await inject(handler, { method: 'GET', url: '/' });
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers['content-type'] || '', /text\/html/);
    assert.match(htmlRes.text, /HealthTrack/);

    const traversal = await inject(handler, { method: 'GET', url: '/../package.json' });
    assert.ok(traversal.status === 403 || traversal.status === 404);

    const encodedTraversal = await inject(handler, { method: 'GET', url: '/%2e%2e/package.json' });
    assert.ok(encodedTraversal.status === 403 || encodedTraversal.status === 404);

    const nullByte = await inject(handler, { method: 'GET', url: '/%00' });
    assert.equal(nullByte.status, 400);

    const methodNotAllowed = await inject(handler, { method: 'DELETE', url: '/index.html' });
    assert.equal(methodNotAllowed.status, 405);
    assert.equal(methodNotAllowed.headers['allow'], 'GET, POST');

    const notFoundRes = await inject(handler, { method: 'GET', url: '/api/nonexistent' });
    assert.equal(notFoundRes.status, 404);
  });

  it('GET /api/patients/:patientId/summary returns all-time stats and 30-day daily averages', async () => {
    const now = Date.now();
    const recentIso1 = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const recentIso2 = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
    const oldIso = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();

    for (const entry of [
      { symptomDescription: 'Old headache', severity: 9, timestamp: oldIso },
      { symptomDescription: 'Recent headache', severity: 6, timestamp: recentIso1 },
      { symptomDescription: 'Recovering', severity: 3, timestamp: recentIso2 }
    ]) {
      await inject(handler, {
        method: 'POST',
        url: '/api/symptoms',
        body: { patientId: 'PAT-SUM', ...entry }
      });
    }

    const res = await inject(handler, { method: 'GET', url: '/api/patients/PAT-SUM/summary' });
    assert.equal(res.status, 200);
    const { summary } = res.json();
    assert.equal(summary.totalCount, 3);
    assert.equal(summary.peakSeverity, 9);
    assert.equal(summary.averageSeverity, 6);
    assert.equal(summary.recentDelta, -3);
    assert.equal(summary.dailyAverages30d.length, 2);
  });

  it('enforces API rate limiting with 429 Too Many Requests', async () => {
    const limitedHandler = createRequestHandler({ store, rateLimitMax: 2 });
    assert.equal((await inject(limitedHandler, { method: 'GET', url: '/api/health' })).status, 200);
    assert.equal((await inject(limitedHandler, { method: 'GET', url: '/api/health' })).status, 200);
    const blocked = await inject(limitedHandler, { method: 'GET', url: '/api/health' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers['retry-after']);
  });

  it('returns 500 when an unexpected store error occurs', async () => {
    const failingHandler = createRequestHandler({
      store: {
        listPatients() {
          throw new Error('Simulated DB failure');
        }
      }
    });

    const res = await inject(failingHandler, { method: 'GET', url: '/api/patients' });
    assert.equal(res.status, 500);
    assert.equal(res.json().error, 'Internal server error.');
  });
});
