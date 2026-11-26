import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMIT, MAX_LIMIT } from './db/symptomStore.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_PATIENT_ID_LENGTH,
  MAX_SEVERITY,
  MIN_SEVERITY,
  validatePatientId,
  validateSymptomInput
} from './models/symptom.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MAX_BODY_BYTES = 16 * 1024; // 16 KB
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const BASE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...BASE_SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function createRateLimiter({ windowMs = RATE_LIMIT_WINDOW_MS, max = RATE_LIMIT_MAX_REQUESTS } = {}) {
  const buckets = new Map();

  return (req) => {
    const ip = req.socket?.remoteAddress || 'in-process';
    const now = Date.now();
    const entry = buckets.get(ip);

    if (!entry || now >= entry.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return { allowed: false, retryAfterSec };
    }

    return { allowed: true };
  };
}

function parsePagination(url) {
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');

  let limit = DEFAULT_LIMIT;
  let offset = 0;

  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw new HttpError(
        400,
        `Invalid limit parameter. Must be an integer between 1 and ${MAX_LIMIT}.`
      );
    }
    limit = parsed;
  }

  if (rawOffset !== null) {
    const parsed = Number(rawOffset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new HttpError(400, 'Invalid offset parameter. Must be a non-negative integer.');
    }
    offset = parsed;
  }

  return { limit, offset };
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body exceeds maximum allowed size.');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    throw new HttpError(400, 'Request body cannot be empty.');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON in request body.');
  }
}

async function serveStatic(reqPath, publicDir, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(reqPath);
  } catch {
    sendJson(res, 400, { error: 'Malformed URL path.' });
    return;
  }

  if (decodedPath.includes('\0')) {
    sendJson(res, 400, { error: 'Malformed URL path.' });
    return;
  }

  const safeRelativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const resolvedRoot = path.resolve(publicDir);
  const resolvedFile = path.resolve(resolvedRoot, safeRelativePath);

  if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const content = await fs.readFile(resolvedFile);
    const ext = path.extname(resolvedFile).toLowerCase();
    res.writeHead(200, {
      ...BASE_SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      sendJson(res, 404, { error: 'Resource not found.' });
      return;
    }
    throw err;
  }
}

/**
 * Creates the HTTP request handler for HealthTrack API and static frontend assets.
 * @param {{
 *   store: import('./db/symptomStore.js').SymptomStore,
 *   publicDir?: string,
 *   rateLimitMax?: number,
 *   logger?: (entry: { timestamp: string, method: string, path: string, status: number, durationMs: number }) => void
 * }} options
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>}
 */
export function createRequestHandler({
  store,
  publicDir = DEFAULT_PUBLIC_DIR,
  rateLimitMax = RATE_LIMIT_MAX_REQUESTS,
  logger = (entry) => console.log(JSON.stringify(entry))
}) {
  const checkRateLimit = createRateLimiter({ max: rateLimitMax });

  const routes = [
    {
      method: 'GET',
      match: (p) => p === '/api/health',
      handle: async (_req, res) => {
        sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
      }
    },
    {
      method: 'GET',
      match: (p) => p === '/api/config',
      handle: async (_req, res) => {
        sendJson(res, 200, {
          minSeverity: MIN_SEVERITY,
          maxSeverity: MAX_SEVERITY,
          maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
          maxPatientIdLength: MAX_PATIENT_ID_LENGTH,
          defaultLimit: DEFAULT_LIMIT,
          maxLimit: MAX_LIMIT
        });
      }
    },
    {
      method: 'GET',
      match: (p) => p === '/api/patients',
      handle: async (_req, res, url) => {
        const { limit, offset } = parsePagination(url);
        const patients = store.listPatients({ limit, offset });
        sendJson(res, 200, { patients, limit, offset });
      }
    },
    {
      method: 'GET',
      match: (p) => /^\/api\/patients\/[^/]+\/summary$/.test(p),
      handle: async (_req, res, url) => {
        const encodedId = url.pathname.slice('/api/patients/'.length, -'/summary'.length);
        let rawPatientId;
        try {
          rawPatientId = decodeURIComponent(encodedId);
        } catch {
          sendJson(res, 400, { error: 'Invalid patient ID encoding.' });
          return;
        }

        const patientCheck = validatePatientId(rawPatientId);
        if (!patientCheck.valid) {
          sendJson(res, 400, {
            error: 'Invalid patient ID.',
            details: [{ field: 'patientId', message: patientCheck.error }]
          });
          return;
        }

        const summary = store.getPatientSummary(patientCheck.value);
        sendJson(res, 200, { summary });
      }
    },
    {
      method: 'POST',
      match: (p) => p === '/api/symptoms',
      handle: async (req, res) => {
        const body = await readJsonBody(req);
        const result = validateSymptomInput(body);
        if (!result.valid) {
          sendJson(res, 400, { error: 'Validation failed.', details: result.errors });
          return;
        }

        const log = store.createLog(result.data);
        sendJson(res, 201, { message: 'Symptom log created successfully.', log });
      }
    },
    {
      method: 'GET',
      match: (p) => p.startsWith('/api/symptoms/'),
      handle: async (_req, res, url) => {
        let rawPatientId;
        try {
          rawPatientId = decodeURIComponent(url.pathname.slice('/api/symptoms/'.length));
        } catch {
          sendJson(res, 400, {
            error: 'Invalid patient ID encoding.',
            details: [{ field: 'patientId', message: 'Malformed URL encoding in patient ID.' }]
          });
          return;
        }

        const patientCheck = validatePatientId(rawPatientId);
        if (!patientCheck.valid) {
          sendJson(res, 400, {
            error: 'Invalid patient ID.',
            details: [{ field: 'patientId', message: patientCheck.error }]
          });
          return;
        }

        const sortParam = url.searchParams.get('sort') || 'asc';
        if (sortParam !== 'asc' && sortParam !== 'desc') {
          sendJson(res, 400, { error: 'Invalid sort parameter. Use "asc" or "desc".' });
          return;
        }

        const { limit, offset } = parsePagination(url);
        const logs = store.getLogsByPatient(patientCheck.value, { sort: sortParam, limit, offset });
        sendJson(res, 200, {
          patientId: patientCheck.value,
          sort: sortParam,
          limit,
          offset,
          count: logs.length,
          logs
        });
      }
    }
  ];

  return async (req, res) => {
    const startNs = process.hrtime.bigint();
    let loggedStatus = 200;
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (code, ...args) => {
      loggedStatus = code;
      return origWriteHead(code, ...args);
    };

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method || 'GET';

      if (pathname.startsWith('/api/')) {
        const rate = checkRateLimit(req);
        if (!rate.allowed) {
          sendJson(
            res,
            429,
            { error: 'Too many requests. Please slow down and try again shortly.' },
            { 'Retry-After': String(rate.retryAfterSec) }
          );
          return;
        }

        const route = routes.find((r) => r.method === method && r.match(pathname));
        if (route) {
          await route.handle(req, res, url);
          return;
        }

        sendJson(res, 404, { error: 'API endpoint not found.' });
        return;
      }

      if (method === 'GET') {
        await serveStatic(pathname, publicDir, res);
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      console.error('Unhandled server error:', err);
      sendJson(res, 500, { error: 'Internal server error.' });
    } finally {
      if (typeof logger === 'function') {
        const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
        logger({
          timestamp: new Date().toISOString(),
          method: req.method || 'GET',
          path: (req.url || '/').split('?')[0],
          status: loggedStatus,
          durationMs: Number(durationMs.toFixed(2))
        });
      }
    }
  };
}

/**
 * Creates the HTTP server for HealthTrack API and static frontend assets.
 * @param {{ store: import('./db/symptomStore.js').SymptomStore, publicDir?: string, rateLimitMax?: number }} options
 * @returns {http.Server}
 */
export function createApp(options) {
  return http.createServer(createRequestHandler(options));
}
