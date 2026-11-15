import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserFarmDraft } from '@/domain/contracts';
import {
  ReportEnvelopeSchema,
  type AnalysisJobRecord,
  type ReportEnvelope,
} from '@/domain/farmer-ux-contracts';

export interface PersistedReportContextMeta {
  reportId: string;
  farmId: string;
  ownerId: string;
  inputRevision: string;
  evidenceVersion: string;
  allowedCitationIds: string[];
  evidenceFacts: Record<string, unknown>;
}

interface PersistedRuntimeStoreState {
  schema: 'astragron.nextjs-runtime-store.v1';
  hmacKeyHex: string;
  jobs: Record<string, AnalysisJobRecord>;
  reports: Record<string, ReportEnvelope>;
  reportContexts: Record<string, PersistedReportContextMeta>;
  farms: Record<string, UserFarmDraft>;
}

const MAX_JOBS = 200;
const MAX_REPORTS = 200;
const MAX_FARMS = 100;

function resolveStorePath(customPath?: string): string {
  const raw =
    customPath ??
    process.env.ASTRAGRON_RUNTIME_STORE_PATH?.trim() ??
    path.join(process.cwd(), 'data', 'runtime', 'astragron-persisted-store.json');
  return path.resolve(raw);
}

function createInitialState(): PersistedRuntimeStoreState {
  return {
    schema: 'astragron.nextjs-runtime-store.v1',
    hmacKeyHex: crypto.randomBytes(32).toString('hex'),
    jobs: {},
    reports: {},
    reportContexts: {},
    farms: {},
  };
}

let activeStorePath = resolveStorePath();
let cachedState: PersistedRuntimeStoreState | null = null;

function ensureLoaded(): PersistedRuntimeStoreState {
  const configured = resolveStorePath();
  if (cachedState && activeStorePath === configured) {
    return cachedState;
  }
  activeStorePath = configured;
  if (fs.existsSync(activeStorePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(activeStorePath, 'utf8')) as Partial<PersistedRuntimeStoreState>;
      const base = createInitialState();
      if (typeof parsed.hmacKeyHex === 'string' && /^[a-f0-9]{64}$/i.test(parsed.hmacKeyHex)) {
        base.hmacKeyHex = parsed.hmacKeyHex;
      }
      if (parsed.jobs && typeof parsed.jobs === 'object') {
        base.jobs = parsed.jobs;
      }
      if (parsed.reports && typeof parsed.reports === 'object') {
        for (const [k, rawRep] of Object.entries(parsed.reports)) {
          const check = ReportEnvelopeSchema.safeParse(rawRep);
          if (check.success) base.reports[k] = check.data;
        }
      }
      if (parsed.reportContexts && typeof parsed.reportContexts === 'object') {
        base.reportContexts = parsed.reportContexts;
      }
      if (parsed.farms && typeof parsed.farms === 'object') {
        base.farms = parsed.farms;
      }
      cachedState = base;
      return cachedState;
    } catch {
      // Corrupt or unreadable runtime file starts clean without breaking requests
    }
  }
  cachedState = createInitialState();
  return cachedState;
}

function flushState(state: PersistedRuntimeStoreState): void {
  try {
    const dir = path.dirname(activeStorePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${activeStorePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, activeStorePath);
  } catch {
    // Do not crash read-only or serverless environments; keep in-memory state consistent
  }
}

function pruneBucket<T>(bucket: Record<string, T>, maxEntries: number): void {
  const keys = Object.keys(bucket);
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) {
    const k = keys[i];
    if (k) delete bucket[k];
  }
}

export function resetPersistedStoreForTests(customPath?: string): void {
  activeStorePath = resolveStorePath(customPath);
  cachedState = null;
}

export function signOwnerToken(ownerId: string, reportId: string): string {
  const state = ensureLoaded();
  const payload = `${ownerId}::${reportId}`;
  return crypto
    .createHmac('sha256', Buffer.from(state.hmacKeyHex, 'hex'))
    .update(payload)
    .digest('hex');
}

export function verifyOwnerToken(token: string, ownerId: string, reportId: string): boolean {
  if (!token || !ownerId || !reportId) return false;
  const expected = signOwnerToken(ownerId, reportId);
  const a = Buffer.from(token.trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function upsertPersistedJob(job: AnalysisJobRecord): AnalysisJobRecord {
  const state = ensureLoaded();
  state.jobs[job.jobId] = job;
  pruneBucket(state.jobs, MAX_JOBS);
  flushState(state);
  return job;
}

export function getPersistedJob(jobId: string): AnalysisJobRecord | null {
  const state = ensureLoaded();
  return state.jobs[jobId] ?? null;
}

export function findPersistedActiveJob(
  farmId: string,
  inputRevision: string,
  datasetMode: string
): AnalysisJobRecord | null {
  const state = ensureLoaded();
  for (const job of Object.values(state.jobs)) {
    if (
      job.farmId === farmId &&
      job.inputRevision === inputRevision &&
      job.datasetMode === datasetMode &&
      (job.status === 'QUEUED' || job.status === 'RUNNING')
    ) {
      return job;
    }
  }
  return null;
}

export function upsertPersistedReport(
  report: ReportEnvelope,
  contextMeta?: PersistedReportContextMeta
): ReportEnvelope {
  const state = ensureLoaded();
  state.reports[report.reportId] = report;
  pruneBucket(state.reports, MAX_REPORTS);
  if (contextMeta) {
    state.reportContexts[report.reportId] = {
      ...contextMeta,
      allowedCitationIds: [...new Set(contextMeta.allowedCitationIds)],
    };
    pruneBucket(state.reportContexts, MAX_REPORTS);
  }
  flushState(state);
  return report;
}

export function getPersistedReport(reportId: string): ReportEnvelope | null {
  const state = ensureLoaded();
  return state.reports[reportId] ?? null;
}

export function getPersistedReportContext(reportId: string): PersistedReportContextMeta | null {
  const state = ensureLoaded();
  return state.reportContexts[reportId] ?? null;
}

export function listPersistedReports(farmId?: string): ReportEnvelope[] {
  const state = ensureLoaded();
  const list = Object.values(state.reports);
  const filtered = farmId ? list.filter((r) => r.farmId === farmId) : list;
  return [...filtered].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function upsertPersistedFarm(farm: UserFarmDraft): UserFarmDraft {
  const state = ensureLoaded();
  state.farms[farm.id] = farm;
  pruneBucket(state.farms, MAX_FARMS);
  flushState(state);
  return farm;
}

export function listPersistedFarms(): Record<string, UserFarmDraft> {
  const state = ensureLoaded();
  return { ...state.farms };
}

export function deletePersistedFarm(farmId: string): boolean {
  const state = ensureLoaded();
  if (!(farmId in state.farms)) return false;
  delete state.farms[farmId];
  flushState(state);
  return true;
}
