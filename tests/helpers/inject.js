import { PassThrough } from 'node:stream';

/**
 * Invokes an HTTP request handler in-process without opening a TCP socket.
 */
export async function inject(handler, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
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
