type StorageKind = 'local' | 'session';

const getStorage = (kind: StorageKind) => {
  if (typeof window === 'undefined') {
    return null;
  }

  return kind === 'local' ? window.localStorage : window.sessionStorage;
};

export const readViewPreference = <T extends string>(
  key: string,
  fallback: T,
  options: {
    storage?: StorageKind;
    allowed?: readonly T[];
  } = {},
): T => {
  const storage = getStorage(options.storage || 'local');
  const stored = storage?.getItem(key);
  if (!stored) {
    return fallback;
  }

  if (options.allowed && !options.allowed.includes(stored as T)) {
    return fallback;
  }

  return stored as T;
};

export const writeViewPreference = (
  key: string,
  value: string | boolean | number | null | undefined,
  options: {
    storage?: StorageKind;
  } = {},
) => {
  const storage = getStorage(options.storage || 'local');
  if (!storage) {
    return;
  }

  if (value === null || value === undefined || value === '') {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, String(value));
};

export const readJsonViewPreference = <T>(
  key: string,
  fallback: T,
  options: {
    storage?: StorageKind;
    validate?: (value: unknown) => value is T;
  } = {},
): T => {
  const storage = getStorage(options.storage || 'local');
  const raw = storage?.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return options.validate && !options.validate(parsed) ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
};

export const writeJsonViewPreference = (
  key: string,
  value: unknown,
  options: {
    storage?: StorageKind;
  } = {},
) => {
  const storage = getStorage(options.storage || 'local');
  if (!storage) {
    return;
  }

  storage.setItem(key, JSON.stringify(value));
};
