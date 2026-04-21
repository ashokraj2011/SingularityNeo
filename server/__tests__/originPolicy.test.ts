// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

describe('origin policy', () => {
  it('allows local dev origins, null origin, and requests without origin', async () => {
    vi.resetModules();
    const { isOriginAllowed, resolveCorsOriginHeader } = await import('../http/originPolicy');

    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed('null')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000')).toBe(true);
    expect(resolveCorsOriginHeader('http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173');
    expect(resolveCorsOriginHeader('null')).toBe('null');
  });

  it('includes the Electron dev server origin when configured and rejects unknown browser origins', async () => {
    vi.resetModules();
    vi.stubEnv('SINGULARITY_ELECTRON_DEV_SERVER_URL', 'http://localhost:4321/workbench');

    const { getAllowedOrigins, isOriginAllowed } = await import('../http/originPolicy');

    expect(getAllowedOrigins().has('http://localhost:4321')).toBe(true);
    expect(isOriginAllowed('https://malicious.example.com')).toBe(false);

    vi.unstubAllEnvs();
  });
});
