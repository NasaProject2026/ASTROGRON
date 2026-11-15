const BLOCKED_OSM_HOSTS = new Set([
  'nominatim.openstreetmap.org',
  'openstreetmap.org',
  'www.openstreetmap.org',
]);

function isIpv4Literal(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPrivateOrForbiddenIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function sanitizeRemoteText(raw: unknown, maxLen = 160): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function isPrivateOrForbiddenHost(
  rawHost: string,
  options: { blockPublicOsmNominatim?: boolean } = {}
): { forbidden: boolean; reason?: string } {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '').trim();
  if (!host) return { forbidden: true, reason: 'Empty hostname.' };

  if (
    options.blockPublicOsmNominatim !== false &&
    (BLOCKED_OSM_HOSTS.has(host) || host.endsWith('.openstreetmap.org'))
  ) {
    return {
      forbidden: true,
      reason:
        'PUBLIC_OSM_NOMINATIM_BLOCKED: Public OpenStreetMap Nominatim endpoints cannot be used as an interactive autocomplete provider.',
    };
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === '::1' ||
    host === '::' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return {
      forbidden: true,
      reason: `Loopback, link-local, or internal host "${host}" is forbidden.`,
    };
  }

  if (isIpv4Literal(host) || isPrivateOrForbiddenIpv4(host) || host.includes(':')) {
    return {
      forbidden: true,
      reason: `Raw IP or private network host "${host}" is forbidden; allowlisted HTTPS domain hostname is required.`,
    };
  }

  return { forbidden: false };
}

export function validateAllowlistedHttpsUrl(
  rawUrl: string,
  allowedHosts: string[],
  label = 'endpoint',
  options: { blockPublicOsmNominatim?: boolean } = {}
): { valid: true; url: URL } | { valid: false; reason: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: `Empty ${label} URL.` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: `Malformed ${label} URL.` };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Insecure protocol "${parsed.protocol}" rejected; ${label} must use HTTPS.`,
    };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded URL credentials are not permitted.' };
  }

  const hostCheck = isPrivateOrForbiddenHost(parsed.hostname, options);
  if (hostCheck.forbidden) {
    return { valid: false, reason: hostCheck.reason ?? 'Forbidden host.' };
  }

  const normalizedAllowlist = allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (normalizedAllowlist.length === 0) {
    return {
      valid: false,
      reason: `Allowed hosts list is empty for ${label}; failing closed to prevent open SSRF relay.`,
    };
  }

  const hostLower = parsed.hostname.toLowerCase();
  if (!normalizedAllowlist.includes(hostLower)) {
    return {
      valid: false,
      reason: `Host "${hostLower}" is not in explicit allowlist for ${label}.`,
    };
  }

  return { valid: true, url: parsed };
}

const LOCAL_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Resolves the ASTRAGRON scientific analysis backend URL while preserving strict HTTPS SSRF checks.
 * Plaintext HTTP is ONLY permitted for explicit local Python co-deployment on `127.0.0.1` / `localhost`
 * when `ASTRAGRON_ALLOW_LOCAL_PYTHON_BACKEND=1` (or `allowLocalPythonBackend: true`) AND the loopback
 * hostname is explicitly present in `allowedHosts`.
 */
export function resolveAnalysisBackendUrl(
  rawUrl: string,
  allowedHosts: string[],
  options?: { allowLocalPythonBackend?: boolean }
): { valid: true; url: URL } | { valid: false; reason: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Empty analysis backend URL.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Malformed analysis backend URL.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded URL credentials are not permitted.' };
  }

  const normalizedAllowlist = allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const hostLower = parsed.hostname.toLowerCase();
  const allowLocal =
    options?.allowLocalPythonBackend ?? process.env.ASTRAGRON_ALLOW_LOCAL_PYTHON_BACKEND === '1';

  if (
    allowLocal &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    LOCAL_LOOPBACK_HOSTS.has(hostLower) &&
    normalizedAllowlist.includes(hostLower)
  ) {
    return { valid: true, url: parsed };
  }

  if (normalizedAllowlist.length > 0) {
    return validateAllowlistedHttpsUrl(trimmed, normalizedAllowlist, 'analysis backend');
  }

  if (parsed.protocol === 'https:') {
    return { valid: true, url: parsed };
  }

  return {
    valid: false,
    reason: `Insecure or unallowlisted backend transport (${parsed.protocol}//${hostLower}); HTTPS is required.`,
  };
}
