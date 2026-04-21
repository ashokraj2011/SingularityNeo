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
  if (origin === undefined || origin === null) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return true;
  }

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
