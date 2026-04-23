/**
 * Origin / CORS policy for Singularity Neo.
 *
 * ## Deployment assumption
 *
 * This server is designed to run on localhost or on a private LAN behind a
 * reverse proxy (nginx, Caddy, Traefik, etc.). It is NOT intended to be
 * exposed directly to the public internet. The trust model therefore
 * delegates perimeter security to the network layer: the reverse proxy
 * must enforce TLS and, for production deployments, strip or verify any
 * `x-singularity-actor-*` authentication headers before forwarding.
 *
 * ## Origin bypass rationale
 *
 * The four special cases below look permissive but each has a specific,
 * deliberate reason:
 *
 * 1. `undefined` / `null` origin  — Requests with no Origin header come from
 *    server-to-server calls, curl, or same-origin fetches that the browser
 *    does not annotate. These are safe to allow on a localhost-only server.
 *
 * 2. Empty string origin — After normalization, an empty origin is produced
 *    by certain native HTTP clients and health-check agents. Same rationale
 *    as above.
 *
 * 3. Literal `"null"` origin — The HTML spec requires browsers to send
 *    `Origin: null` for file:// pages and certain sandboxed iframes. The
 *    Electron desktop worker loads pages from `file://`, so this bypass is
 *    required for the desktop app to communicate with the local server.
 *    This is only a risk if the server is reachable from arbitrary,
 *    untrusted web content on the same machine — which is not the case in
 *    the intended deployment topology.
 *
 * ## Threat model boundary
 *
 * These bypasses are safe ONLY when:
 *   a) The server listens exclusively on 127.0.0.1 / localhost or a
 *      private network interface, AND
 *   b) The operator's machine does not run untrusted web content that could
 *      reach the server via the `null`-origin path (e.g. sandboxed ads or
 *      untrusted iframes in another browser tab sharing the same loopback).
 *
 * If you ever need to expose this server to a broader network, remove the
 * `null`-origin bypass and require explicit CORS allowlisting instead.
 */

const normalizeOrigin = (value?: string | null) => String(value || '').trim().replace(/\/+$/, '');

const originFromUrl = (value?: string | null) => {
  const normalized = normalizeOrigin(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return null;
  }
};

export const getAllowedOrigins = () => {
  const configuredOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    originFromUrl(process.env.SINGULARITY_ELECTRON_DEV_SERVER_URL),
  ].filter(Boolean) as string[];

  return new Set(configuredOrigins);
};

export const isOriginAllowed = (origin?: string | null) => {
  // Bypass 1 & 2: no origin or empty — server-to-server / health checks.
  if (origin === undefined || origin === null) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return true;
  }

  // Bypass 3: literal "null" — Electron/file:// and sandboxed iframes.
  // See module-level comment for the threat-model boundary.
  if (normalized === 'null') {
    return true;
  }

  return getAllowedOrigins().has(normalized);
};

export const resolveCorsOriginHeader = (origin?: string | null) => {
  if (origin === undefined || origin === null) {
    return null;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return null;
  }

  if (normalized === 'null') {
    return 'null';
  }

  return isOriginAllowed(normalized) ? normalized : null;
};
