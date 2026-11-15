import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { validateAllowlistedHttpsUrl } from '@/server/ssrf-guard';

// This module is imported only by server route handlers. Never put its configuration
// in NEXT_PUBLIC variables or accept backend URLs / bearer credentials from requests.
export const CORE_COOKIE = 'astrogron_session';
export const SESSION_SECONDS = 12 * 60 * 60;
type Session = { expires: number; analyses: string[]; conversations: Record<string, string> };
export class CoreProblem extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

function stateRoot() {
  return process.env.ASTRAGRON_UNIFIED_STATE_DIR || path.join(process.cwd(), '.runtime', 'unified');
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function sessionFile(id: string) { return path.join(stateRoot(), 'sessions', `${hash(id)}.json`); }
function save(id: string, session: Session) {
  const file = sessionFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function sessionId(request: Request): string {
  const value = (request.headers.get('cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(`${CORE_COOKIE}=`))?.slice(CORE_COOKIE.length + 1) || '';
  if (!/^[a-f0-9]{64}$/.test(value)) throw new CoreProblem(401, 'LOCAL_ACCESS_REQUIRED');
  readSession(value);
  return value;
}
function readSession(id: string): Session {
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile(id), 'utf8')) as Session;
    if (session.expires > Date.now() && Array.isArray(session.analyses) && session.conversations) return session;
  } catch { /* A missing or damaged session grants no access. */ }
  throw new CoreProblem(401, 'SESSION_EXPIRED');
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') || '';
  const publicOrigin = configuredPublicOrigin();
  if (publicOrigin && origin === publicOrigin &&
      (/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{2,5}$/.test(host) || host === new URL(publicOrigin).host)) {
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new CoreProblem(403, 'SAME_ORIGIN_REQUIRED');
    return;
  }
  // Next may normalize request.url to localhost internally. Bind the browser Origin
  // to the actual HTTP Host, and accept loopback hostnames only in this local release.
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{2,5}$/.test(host)) throw new CoreProblem(403, 'SAME_ORIGIN_REQUIRED');
  let source: URL;
  try { source = new URL(origin || ''); } catch { throw new CoreProblem(403, 'SAME_ORIGIN_REQUIRED'); }
  if (source.host !== host || !['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.origin !== origin) throw new CoreProblem(403, 'SAME_ORIGIN_REQUIRED');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new CoreProblem(403, 'SAME_ORIGIN_REQUIRED');
}
export function configuredPublicOrigin(): string | null {
  const file = process.env.ASTRAGRON_PUBLIC_ORIGIN_FILE;
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const url = new URL(raw);
    if (url.protocol === 'https:' && /^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) &&
        !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && raw === url.origin) return raw;
  } catch { /* An absent or malformed tunnel origin never relaxes CSRF checks. */ }
  return null;
}
export function secureBrowserCookie(request: Request) {
  return new URL(request.url).protocol === 'https:' ||
    Boolean(configuredPublicOrigin() && request.headers.get('origin') === configuredPublicOrigin());
}
const loginAttempts: number[] = [];
export function login(code: unknown): string {
  const now = Date.now();
  while (loginAttempts.length && loginAttempts[0]! < now - 60_000) loginAttempts.shift();
  if (loginAttempts.length >= 15) throw new CoreProblem(429, 'ACCESS_RATE_LIMIT');
  loginAttempts.push(now);
  const codeFile = process.env.ASTRAGRON_DEMO_ACCESS_FILE;
  if (!codeFile) throw new CoreProblem(503, 'LOCAL_ACCESS_NOT_CONFIGURED');
  let expected: string;
  try { expected = fs.readFileSync(codeFile, 'utf8').trim(); }
  catch { throw new CoreProblem(503, 'LOCAL_ACCESS_NOT_CONFIGURED'); }
  if (expected.length < 16 || typeof code !== 'string' || code.length > 200 ||
      !timingSafeEqual(Buffer.from(hash(code)), Buffer.from(hash(expected)))) {
    throw new CoreProblem(401, 'INVALID_ACCESS_CODE');
  }
  const id = randomBytes(32).toString('hex');
  save(id, { expires: now + SESSION_SECONDS * 1000, analyses: [], conversations: {} });
  return id;
}
export function logout(id: string) { fs.rmSync(sessionFile(id), { force: true }); }
export function grantAnalyses(id: string, aids: string[]) {
  const session = readSession(id);
  const valid = aids.filter(a => /^[a-f0-9]{32}$/.test(a));
  session.analyses = [...new Set([...session.analyses, ...valid])];
  if (session.analyses.length > 64) throw new CoreProblem(429, 'SESSION_ANALYSIS_LIMIT');
  save(id, session);
}
export function ownAnalysis(id: string, aid: string) {
  if (!/^[a-f0-9]{32}$/.test(aid) || !readSession(id).analyses.includes(aid)) {
    throw new CoreProblem(404, 'ANALYSIS_NOT_FOUND');
  }
}
export function grantConversation(id: string, sid: string, aid: string) {
  ownAnalysis(id, aid);
  if (!/^[a-f0-9]{32}$/.test(sid)) throw new CoreProblem(502, 'INVALID_CORE_CONVERSATION');
  const session = readSession(id);
  session.conversations[sid] = aid;
  save(id, session);
}
export function ownConversation(id: string, sid: string) {
  const aid = readSession(id).conversations[sid];
  if (!/^[a-f0-9]{32}$/.test(sid) || !aid) throw new CoreProblem(404, 'CONVERSATION_NOT_FOUND');
  ownAnalysis(id, aid);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new CoreProblem(415, 'JSON_REQUIRED');
  const reader = request.body?.getReader();
  if (!reader) throw new CoreProblem(400, 'INVALID_JSON');
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 524288) { await reader.cancel(); throw new CoreProblem(413, 'REQUEST_TOO_LARGE'); }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* Do not return submitted content in errors. */ }
  throw new CoreProblem(400, 'INVALID_JSON');
}

export async function coreFetch(endpoint: string, method = 'GET', body?: unknown): Promise<Response> {
  const base = configuredCoreEndpoint(process.env.ASTRAGRON_BACKEND_URL,
    (process.env.ASTRAGRON_BACKEND_ALLOWED_HOSTS || '').split(','));
  const tokenFile = process.env.ASTRAGRON_BACKEND_TOKEN_FILE;
  if (!tokenFile) throw new CoreProblem(503, 'CORE_AUTH_NOT_CONFIGURED');
  let token: string;
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); }
  catch { throw new CoreProblem(503, 'CORE_AUTH_NOT_CONFIGURED'); }
  if (token.length < 24 || /[\r\n]/.test(token)) throw new CoreProblem(503, 'CORE_AUTH_NOT_CONFIGURED');
  try {
    return await fetch(new URL(endpoint, base), {
      method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new CoreProblem(503, 'CORE_UNREACHABLE'); }
}
export function configuredCoreEndpoint(raw: string | undefined, allowedHosts: string[]): URL {
  if (!raw) throw new CoreProblem(503, 'CORE_ENDPOINT_REQUIRED');
  let base: URL;
  try { base = new URL(raw); } catch { throw new CoreProblem(503, 'INVALID_CORE_URL'); }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new CoreProblem(503, 'INVALID_CORE_URL');
  // HTTP is confined to the co-deployed loopback service. Future remote D hosts
  // require TLS and an exact operator-owned allowlist; redirects remain forbidden.
  if (base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname)) return base;
  const checked = validateAllowlistedHttpsUrl(raw, allowedHosts, 'scientific backend');
  if (!checked.valid) throw new CoreProblem(503, 'CORE_HTTPS_ALLOWLIST_REQUIRED');
  return checked.url;
}
export async function coreJson(endpoint: string, method = 'GET', body?: unknown) {
  const response = await coreFetch(endpoint, method, body);
  const value = await response.json();
  if (!response.ok) throw new CoreProblem(response.status, typeof value.error === 'string' ? value.error : 'CORE_REQUEST_FAILED');
  return value;
}
