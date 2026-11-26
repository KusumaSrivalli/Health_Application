import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { validatePatientId, validateSymptomInput } from './models/symptom.js';

const MAX_BODY_BYTES = 16 * 1024; // 16 KB

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
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
  const safeRelativePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
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
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'X-Content-Type-Options': 'nosniff'
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
 * @param {{ store: import('./db/symptomStore.js').SymptomStore, publicDir?: string }} options
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>}
 */
export function createRequestHandler({ store, publicDir = path.resolve(process.cwd(), 'public') }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method || 'GET';

      // Health check
      if (method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
        return;
      }

      // List patients with summary metrics
      if (method === 'GET' && pathname === '/api/patients') {
        const patients = store.listPatients();
        sendJson(res, 200, { patients });
        return;
      }

      // Submit a new symptom log
      if (method === 'POST' && pathname === '/api/symptoms') {
        const body = await readJsonBody(req);
        const result = validateSymptomInput(body);
        if (!result.valid) {
          sendJson(res, 400, {
            error: 'Validation failed.',
            details: result.errors
          });
          return;
        }

        const log = store.createLog(result.data);
        sendJson(res, 201, { log });
        return;
      }

      // Retrieve all symptom logs for a specific patient, sorted by timestamp
      if (method === 'GET' && pathname.startsWith('/api/symptoms/')) {
        const rawPatientId = decodeURIComponent(pathname.slice('/api/symptoms/'.length));
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
          sendJson(res, 400, {
            error: 'Invalid sort parameter. Use "asc" or "desc".'
          });
          return;
        }

        const logs = store.getLogsByPatient(patientCheck.value, { sort: sortParam });
        sendJson(res, 200, {
          patientId: patientCheck.value,
          sort: sortParam,
          count: logs.length,
          logs
        });
        return;
      }

      // Unknown API routes
      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'API endpoint not found.' });
        return;
      }

      // Serve static frontend files
      if (method === 'GET') {
        await serveStatic(pathname, publicDir, res);
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      console.error('Unhandled server error:', err);
      sendJson(res, 500, { error: 'Internal server error.' });
    }
  };
}

/**
 * Creates the HTTP server for HealthTrack API and static frontend assets.
 * @param {{ store: import('./db/symptomStore.js').SymptomStore, publicDir?: string }} options
 * @returns {http.Server}
 */
export function createApp(options) {
  return http.createServer(createRequestHandler(options));
}
