import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createRequestHandler } from '../src/app.js';
import { SymptomStore } from '../src/db/symptomStore.js';

/**
 * Invokes an HTTP request handler in-process without opening a TCP socket.
 */
async function inject(handler, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', ...headers };

  const chunks = [];
  let statusCode = 200;
  let responseHeaders = {};

  const res = {
    writeHead(code, hdrs = {}) {
      statusCode = code;
      responseHeaders = Object.fromEntries(
        Object.entries(hdrs).map(([k, v]) => [k.toLowerCase(), v])
      );
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    }
  };

  if (body !== null) {
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  } else {
    req.end();
  }

  await handler(req, res);

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return {
    status: statusCode,
    headers: responseHeaders,
    text: rawBody,
    json() {
      return JSON.parse(rawBody);
    }
  };
}

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

  it('GET /api/health returns ok status', async () => {
    const res = await inject(handler, { method: 'GET', url: '/api/health' });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.ok(body.timestamp);
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

    const listAsc = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/PAT-200?sort=asc'
    });
    assert.equal(listAsc.status, 200);
    const ascBody = listAsc.json();
    assert.equal(ascBody.count, 2);
    assert.deepEqual(
      ascBody.logs.map((l) => l.symptomDescription),
      ['Morning chills', 'Evening fever']
    );

    const listDesc = await inject(handler, {
      method: 'GET',
      url: '/api/symptoms/PAT-200?sort=desc'
    });
    assert.equal(listDesc.status, 200);
    const descBody = listDesc.json();
    assert.deepEqual(
      descBody.logs.map((l) => l.symptomDescription),
      ['Evening fever', 'Morning chills']
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

  it('POST /api/symptoms returns 400 on malformed JSON', async () => {
    const res = await inject(handler, {
      method: 'POST',
      url: '/api/symptoms',
      headers: { 'content-type': 'application/json' },
      body: '{bad json'
    });
    assert.equal(res.status, 400);
    const body = res.json();
    assert.match(body.error, /Invalid JSON/);
  });

  it('GET /api/symptoms/:patientId returns empty array for unknown patient and 400 for invalid sort', async () => {
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

  it('serves static index.html at / and returns 404 for unknown API routes', async () => {
    const htmlRes = await inject(handler, { method: 'GET', url: '/' });
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers['content-type'] || '', /text\/html/);
    assert.match(htmlRes.text, /HealthTrack/);

    const notFoundRes = await inject(handler, { method: 'GET', url: '/api/nonexistent' });
    assert.equal(notFoundRes.status, 404);
  });
});
