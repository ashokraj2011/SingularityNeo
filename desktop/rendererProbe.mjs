import http from 'node:http';

const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_CAPTURED_BODY_CHARS = 8_192;

const normalizeHeader = value =>
  Array.isArray(value) ? value.join(', ') : String(value || '');

export const fetchUrlProbe = (url, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  new Promise(resolve => {
    const request = http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');

      response.on('data', chunk => {
        if (body.length >= MAX_CAPTURED_BODY_CHARS) {
          return;
        }
        body += chunk.slice(0, MAX_CAPTURED_BODY_CHARS - body.length);
      });

      response.on('end', () => {
        clearTimeout(timeout);
        resolve({
          ok: true,
          statusCode: response.statusCode || 0,
          contentType: normalizeHeader(response.headers['content-type']),
          body,
        });
      });
    });

    request.on('error', () => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        statusCode: 0,
        contentType: '',
        body: '',
      });
    });

    const timeout = setTimeout(() => {
      request.destroy();
      resolve({
        ok: false,
        statusCode: 0,
        contentType: '',
        body: '',
      });
    }, timeoutMs);
  });

export const probeHttpSuccessUrl = async (url, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const result = await fetchUrlProbe(url, timeoutMs);
  return result.ok && result.statusCode >= 200 && result.statusCode < 400;
};

export const looksLikeSingularityRendererResponse = probe => {
  if (!probe?.ok || probe.statusCode < 200 || probe.statusCode >= 400) {
    return false;
  }

  const contentType = String(probe.contentType || '').toLowerCase();
  const body = String(probe.body || '');

  if (contentType && !contentType.includes('text/html')) {
    return false;
  }

  return (
    /<title>\s*Singularity\s*<\/title>/i.test(body) &&
    /<div\s+id=["']root["']\s*><\/div>/i.test(body)
  ) || /src=["']\/src\/main\.tsx["']/i.test(body);
};

export const probeRendererUrl = async (url, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  looksLikeSingularityRendererResponse(await fetchUrlProbe(url, timeoutMs));
