import {
  ReportEnvelopeSchema,
  type AnalysisJobRecord,
  type AnalysisJobTriggerRequest,
  type ReportEnvelope,
} from '@/domain/farmer-ux-contracts';
import type { RepositoryStatusCode } from '@/domain/contracts';
import { RepositoryStatusCodeSchema } from '@/domain/schemas';
import { UPPSALA_REFERENCE_INPUT_REVISION } from '@/fixtures/sites-and-coverage';
import { registerServerVerifiedReportContext } from './chat-gateway-service';
import { loadAndVerifyStagedCorpora } from './corpus-integrity';
import {
  findPersistedActiveJob,
  getPersistedJob,
  upsertPersistedJob,
  upsertPersistedReport,
} from './persisted-runtime-store';
import { resolveAnalysisBackendUrl } from './ssrf-guard';

const MAX_RECENT_JOBS = 120;
const recentJobs = new Map<string, AnalysisJobRecord>();

function findActiveJobForRevision(
  farmId: string,
  inputRevision: string,
  datasetMode: AnalysisJobTriggerRequest['datasetMode']
): AnalysisJobRecord | null {
  for (const job of recentJobs.values()) {
    if (
      job.farmId === farmId &&
      job.inputRevision === inputRevision &&
      job.datasetMode === datasetMode &&
      (job.status === 'QUEUED' || job.status === 'RUNNING')
    ) {
      return job;
    }
  }
  const persisted = findPersistedActiveJob(farmId, inputRevision, datasetMode);
  if (persisted) {
    recentJobs.set(persisted.jobId, persisted);
    return persisted;
  }
  return null;
}

function storeJob(record: AnalysisJobRecord): AnalysisJobRecord {
  if (recentJobs.size >= MAX_RECENT_JOBS) {
    const oldestKey = recentJobs.keys().next().value;
    if (oldestKey) recentJobs.delete(oldestKey);
  }
  recentJobs.set(record.jobId, record);
  upsertPersistedJob(record);
  return record;
}

function resolveUpstreamFailClosedStatus(
  rawStatusCode: unknown,
  jobStatus: AnalysisJobRecord['status'],
  farmId: string,
  req: AnalysisJobTriggerRequest
): RepositoryStatusCode | null {
  if (jobStatus === 'QUEUED' || jobStatus === 'RUNNING') {
    return null;
  }
  const parsedCode = RepositoryStatusCodeSchema.safeParse(rawStatusCode);
  if (parsedCode.success) {
    return parsedCode.data;
  }
  const isUnmodifiedUppsala =
    (farmId === 'uppsala-demo' || farmId === 'uppsala-m14') &&
    !req.inputsModified &&
    !req.isUserCreatedDraft &&
    req.inputRevision === UPPSALA_REFERENCE_INPUT_REVISION;

  if (jobStatus === 'COMPLETED_VERIFIED') return 'OK_RECORDED_RESEARCH';
  if (jobStatus === 'ABSTAINED') return isUnmodifiedUppsala ? 'OK_RECORDED_RESEARCH' : 'MODEL_UNQUALIFIED';
  if (jobStatus === 'COMPLETED_LIMITED') return 'OK_COVERAGE_ONLY';
  if (jobStatus === 'UNAVAILABLE') return 'MODEL_UNQUALIFIED';
  if (jobStatus === 'FAILED') return 'SOURCE_NOT_PROVIDED';
  return 'OK_COVERAGE_ONLY';
}

export function createAnalysisJob(
  farmId: string,
  req: AnalysisJobTriggerRequest
): AnalysisJobRecord {
  const now = new Date().toISOString();
  const jobId = `job-${farmId.slice(0, 18)}-${Date.now().toString(36)}`;
  const hasLiveBackend = process.env.ASTRAGRON_BACKEND_PROTOCOL !== 'D_V1' && Boolean(process.env.ASTRAGRON_BACKEND_URL?.trim());
  const corpus = loadAndVerifyStagedCorpora();

  let status: AnalysisJobRecord['status'] = 'COMPLETED_LIMITED';
  let currentStage = 'Regional satellite coverage check finished';
  let message =
    'Regional Earth-observation context was checked. Live multi-year crop optimization is unavailable because the ASTRAGRON scientific engine is not connected.';
  let failClosedStatus: AnalysisJobRecord['failClosedStatus'] =
    req.inputsModified || req.isUserCreatedDraft
      ? 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
      : 'OK_COVERAGE_ONLY';

  if (hasLiveBackend) {
    // Synchronous fallback path must never fabricate a pending QUEUED state without verified HTTP dispatch
    status = 'FAILED';
    currentStage = 'Scientific backend dispatch unverified';
    message =
      'ASTRAGRON_BACKEND_URL requires verified async HTTP transport via /api/farms/[farmId]/analyses; failing closed.';
    failClosedStatus = 'BACKEND_NOT_CONNECTED';
  } else if (
    (farmId === 'uppsala-demo' || farmId === 'uppsala-m14') &&
    !req.inputsModified &&
    !req.isUserCreatedDraft
  ) {
    const hasVerifiedUppsalaIdentity =
      req.inputRevision === UPPSALA_REFERENCE_INPUT_REVISION &&
      (!req.coordinates ||
        (req.coordinates[0] === 17.6389 && req.coordinates[1] === 59.8586)) &&
      (req.fieldCount === undefined || req.fieldCount === 3);

    if (!hasVerifiedUppsalaIdentity) {
      status = 'COMPLETED_LIMITED';
      currentStage = 'Reference archive revision mismatch';
      message =
        'The submitted inputRevision or site geometry does not match the immutable Uppsala reference archive. Recorded M14 outcomes are restricted to the unmodified reference revision.';
      failClosedStatus = 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION';
    } else if (req.datasetMode === 'REAL_SCIENTIFIC_BACKEND') {
      status = 'UNAVAILABLE';
      currentStage = 'Live engine offline';
      message =
        'Live scientific compute backend is not connected in this release (BACKEND_NOT_CONNECTED). Switch to Recorded M14 Corpus or Synthetic Demo to inspect reference archives.';
      failClosedStatus = 'BACKEND_NOT_CONNECTED';
    } else if (req.datasetMode === 'RECORDED_M14_RESEARCH' && !corpus.verified) {
      status = 'FAILED';
      currentStage = 'Archive verification failed';
      message = corpus.reason;
      failClosedStatus = 'SOURCE_NOT_PROVIDED';
    } else {
      status = 'ABSTAINED';
      currentStage = 'Multi-year evaluation ready (universal criterion failed)';
      message =
        req.datasetMode === 'RECORDED_M14_RESEARCH'
          ? 'Loaded SHA-verified Recorded M14 archive for Uppsala. Zero tested plans qualified universally; conditional alternatives ready in Report.'
          : 'Loaded Uppsala synthetic demonstration archive. Conditional comparison ready in Report.';
      failClosedStatus =
        req.datasetMode === 'RECORDED_M14_RESEARCH'
          ? 'OK_RECORDED_RESEARCH'
          : 'OK_SYNTHETIC_DEMO';
    }
  } else if (
    (farmId === 'nyeri-kenya' || farmId === 'wagga-australia') &&
    !req.inputsModified &&
    !req.isUserCreatedDraft
  ) {
    status = 'COMPLETED_LIMITED';
    currentStage = 'Coverage-only snapshot ready';
    message =
      'Global EO layer coverage checked for this reference site. Crop optimization models are not calibrated outside Uppsala (MODEL_UNQUALIFIED).';
    failClosedStatus = 'OK_COVERAGE_ONLY';
  }

  return storeJob({
    jobId,
    farmId,
    inputRevision: req.inputRevision,
    datasetMode: req.datasetMode,
    status,
    progressMode: 'INDETERMINATE',
    stageIndex: 3,
    stageTotal: 3,
    currentStage,
    message,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    reportId: null,
    failClosedStatus,
    errorDetail: status === 'FAILED' ? message : null,
  });
}

/**
 * Genuine HTTP-backed analysis dispatch when ASTRAGRON_BACKEND_URL is configured;
 * otherwise cleanly executes honest offline/recorded evaluation. Never leaves dangling QUEUED jobs
 * when upstream dispatch fails or rejects the request.
 */
export async function createAndDispatchAnalysisJob(
  farmId: string,
  req: AnalysisJobTriggerRequest,
  overrides?: {
    backendUrl?: string;
    allowedHosts?: string[];
    allowLocalPythonBackend?: boolean;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }
): Promise<AnalysisJobRecord> {
  if (process.env.ASTRAGRON_BACKEND_PROTOCOL === 'D_V1') {
    if (req.datasetMode !== 'REAL_SCIENTIFIC_BACKEND') return createAnalysisJob(farmId, req);
    const now = new Date().toISOString();
    return storeJob({ jobId: `unqualified-${Date.now().toString(36)}`, farmId,
      inputRevision: req.inputRevision, datasetMode: req.datasetMode, status: 'UNAVAILABLE',
      progressMode: 'INDETERMINATE', stageIndex: 0, stageTotal: 3,
      currentStage: 'Scientific eligibility not established',
      message: 'This saved field has no qualified D scientific request. Open Research Workspace for the admitted Wageningen case or submit a canonical request. No live result was inferred from M4/M14 archives.',
      startedAt: now, updatedAt: now, completedAt: now, reportId: null,
      failClosedStatus: 'MODEL_UNQUALIFIED', errorDetail: null });
  }
  const existingActive = findActiveJobForRevision(farmId, req.inputRevision, req.datasetMode);
  if (existingActive) {
    return existingActive;
  }

  const backendUrlRaw = overrides?.backendUrl ?? process.env.ASTRAGRON_BACKEND_URL?.trim() ?? '';
  if (!backendUrlRaw) {
    return createAnalysisJob(farmId, req);
  }

  const now = new Date().toISOString();
  const jobId = `job-${farmId.slice(0, 18)}-${Date.now().toString(36)}`;
  const allowedHosts =
    overrides?.allowedHosts ??
    (process.env.ASTRAGRON_BACKEND_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const backendCheck = resolveAnalysisBackendUrl(backendUrlRaw, allowedHosts, {
    allowLocalPythonBackend: overrides?.allowLocalPythonBackend,
  });
  const validatedUrl: URL | null = backendCheck.valid ? backendCheck.url : null;

  if (!validatedUrl) {
    return storeJob({
      jobId,
      farmId,
      inputRevision: req.inputRevision,
      datasetMode: req.datasetMode,
      status: 'FAILED',
      progressMode: 'INDETERMINATE',
      stageIndex: 1,
      stageTotal: 3,
      currentStage: 'Backend configuration rejected',
      message: backendCheck.valid
        ? 'Invalid backend configuration.'
        : backendCheck.reason,
      startedAt: now,
      updatedAt: now,
      completedAt: now,
      reportId: null,
      failClosedStatus: 'BACKEND_NOT_CONNECTED',
      errorDetail: 'Invalid or non-HTTPS analysis backend URL.',
    });
  }

  const targetUrl = new URL(validatedUrl.toString());
  targetUrl.pathname = `${targetUrl.pathname.replace(/\/+$/, '')}/analyses`;

  const fetchFn = overrides?.fetchImpl ?? fetch;
  const envTimeout = Number(process.env.ASTRAGRON_BACKEND_TIMEOUT_MS);
  const timeoutMs =
    overrides?.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 60000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetchFn(targetUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...req, clientJobId: jobId }),
      redirect: 'error',
      signal: ac.signal,
    });

    if (!res.ok) {
      const errMsg = `Configured scientific backend returned HTTP ${res.status}.`;
      return storeJob({
        jobId,
        farmId,
        inputRevision: req.inputRevision,
        datasetMode: req.datasetMode,
        status: 'FAILED',
        progressMode: 'INDETERMINATE',
        stageIndex: 1,
        stageTotal: 3,
        currentStage: 'Scientific backend error',
        message: `${errMsg} Local M4 coverage metadata remains available.`,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        reportId: null,
        failClosedStatus: 'BACKEND_NOT_CONNECTED',
        errorDetail: errMsg,
      });
    }

    const body = (await res.json().catch(() => null)) as
      | {
          jobId?: string;
          farmId?: string;
          inputRevision?: string;
          status?: AnalysisJobRecord['status'];
          failClosedStatus?: string;
          currentStage?: string;
          message?: string;
          reportId?: string | null;
          evidenceVerified?: boolean;
          statusOutcome?: string;
          allowedCitationIds?: unknown;
          evidenceFacts?: unknown;
          reportEnvelope?: unknown;
          adaptiveSummary?: unknown;
        }
      | null;

    if (!body || !body.status) {
      return storeJob({
        jobId,
        farmId,
        inputRevision: req.inputRevision,
        datasetMode: req.datasetMode,
        status: 'FAILED',
        progressMode: 'INDETERMINATE',
        stageIndex: 1,
        stageTotal: 3,
        currentStage: 'Invalid backend response',
        message: 'Scientific backend response did not include a valid analysis job status.',
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        reportId: null,
        failClosedStatus: 'BACKEND_NOT_CONNECTED',
        errorDetail: 'Malformed upstream analysis payload.',
      });
    }

    const allowedStatuses = new Set<AnalysisJobRecord['status']>([
      'QUEUED',
      'RUNNING',
      'COMPLETED_VERIFIED',
      'COMPLETED_LIMITED',
      'ABSTAINED',
      'FAILED',
      'UNAVAILABLE',
      'CANCELLED',
    ]);
    if (!allowedStatuses.has(body.status)) {
      return storeJob({
        jobId,
        farmId,
        inputRevision: req.inputRevision,
        datasetMode: req.datasetMode,
        status: 'FAILED',
        progressMode: 'INDETERMINATE',
        stageIndex: 1,
        stageTotal: 3,
        currentStage: 'Upstream schema validation failed',
        message:
          'Upstream scientific backend returned an unrecognized status payload. Refusing to fabricate or display unverified results.',
        startedAt: now,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        reportId: null,
        failClosedStatus: 'SOURCE_NOT_PROVIDED',
        errorDetail: `Invalid upstream status: ${String(body.status)}`,
      });
    }

    if (body.status === 'COMPLETED_VERIFIED') {
      const boundFarmMatches = body.farmId === farmId;
      const boundRevisionMatches = body.inputRevision === req.inputRevision;
      const validReportId = typeof body.reportId === 'string' && body.reportId.trim().length > 0;
      const verifiedEvidenceFlag = body.evidenceVerified === true;

      if (!boundFarmMatches || !boundRevisionMatches || !validReportId || !verifiedEvidenceFlag) {
        return storeJob({
          jobId,
          farmId,
          inputRevision: req.inputRevision,
          datasetMode: req.datasetMode,
          status: 'FAILED',
          progressMode: 'INDETERMINATE',
          stageIndex: 1,
          stageTotal: 3,
          currentStage: 'Upstream provenance verification failed',
          message:
            'Upstream scientific backend returned COMPLETED_VERIFIED without matching farmId, inputRevision, reportId, and verified evidence provenance.',
          startedAt: now,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          reportId: null,
          failClosedStatus: 'SOURCE_NOT_PROVIDED',
          errorDetail:
            'Rejected upstream COMPLETED_VERIFIED response lacking bound farmId, inputRevision, reportId, or evidenceVerified=true.',
        });
      }
    }

    const remotePending = body.status === 'QUEUED' || body.status === 'RUNNING';
    const failClosedStatus = resolveUpstreamFailClosedStatus(
      body.failClosedStatus,
      body.status,
      farmId,
      req
    );

    let verifiedEnvelope: ReportEnvelope | undefined;
    if (!remotePending && body.reportEnvelope) {
      const parsedRep = ReportEnvelopeSchema.safeParse(body.reportEnvelope);
      if (
        parsedRep.success &&
        parsedRep.data.farmId === farmId &&
        parsedRep.data.inputRevision === req.inputRevision
      ) {
        verifiedEnvelope = parsedRep.data;
        const citations = Array.isArray(body.allowedCitationIds)
          ? body.allowedCitationIds.filter((c): c is string => typeof c === 'string' && c.length > 0)
          : [parsedRep.data.corpusVersion];
        const facts =
          body.evidenceFacts && typeof body.evidenceFacts === 'object' && !Array.isArray(body.evidenceFacts)
            ? (body.evidenceFacts as Record<string, unknown>)
            : { statusOutcome: body.statusOutcome ?? null, failClosedStatus };

        const contextMeta = {
          reportId: verifiedEnvelope.reportId,
          farmId,
          ownerId: `local-session-${farmId}`,
          inputRevision: verifiedEnvelope.inputRevision,
          evidenceVersion: verifiedEnvelope.corpusVersion,
          allowedCitationIds: citations,
          evidenceFacts: facts,
        };
        upsertPersistedReport(verifiedEnvelope, contextMeta);
        registerServerVerifiedReportContext(contextMeta);
      }
    }

    const finalReportId =
      verifiedEnvelope?.reportId ??
      (typeof body.reportId === 'string' && body.reportId.trim() ? body.reportId.trim() : null);

    return storeJob({
      jobId: typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : jobId,
      farmId,
      inputRevision: req.inputRevision,
      datasetMode: req.datasetMode,
      status: body.status,
      progressMode: 'STAGE_DISCRETE',
      stageIndex: remotePending ? 1 : 3,
      stageTotal: 3,
      currentStage: body.currentStage || 'Upstream scientific evaluation',
      message: body.message || 'Dispatched cleanly to verified ASTRAGRON backend.',
      startedAt: now,
      updatedAt: new Date().toISOString(),
      completedAt: remotePending ? null : new Date().toISOString(),
      reportId: finalReportId,
      failClosedStatus,
      errorDetail: null,
      reportEnvelope: verifiedEnvelope,
      adaptiveSummary:
        body.adaptiveSummary && typeof body.adaptiveSummary === 'object' && !Array.isArray(body.adaptiveSummary)
          ? (body.adaptiveSummary as Record<string, unknown>)
          : undefined,
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    const errMsg = timedOut
      ? `Scientific backend timed out after ${timeoutMs} ms.`
      : 'Configured scientific backend is unreachable.';
    return storeJob({
      jobId,
      farmId,
      inputRevision: req.inputRevision,
      datasetMode: req.datasetMode,
      status: 'FAILED',
      progressMode: 'INDETERMINATE',
      stageIndex: 1,
      stageTotal: 3,
      currentStage: 'Scientific backend unreachable',
      message: `${errMsg} You can still view M4 regional coverage and save local reports.`,
      startedAt: now,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      reportId: null,
      failClosedStatus: 'BACKEND_NOT_CONNECTED',
      errorDetail: errMsg,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function getAnalysisJob(jobId: string): AnalysisJobRecord | null {
  const mem = recentJobs.get(jobId);
  if (mem) return mem;
  const persisted = getPersistedJob(jobId);
  if (persisted) {
    recentJobs.set(jobId, persisted);
    return persisted;
  }
  return null;
}

export function cancelAnalysisJob(jobId: string): AnalysisJobRecord | null {
  const existing = getAnalysisJob(jobId);
  if (!existing) return null;
  if (
    existing.status === 'QUEUED' ||
    existing.status === 'RUNNING' ||
    existing.status === 'COMPLETED_LIMITED'
  ) {
    const updated: AnalysisJobRecord = {
      ...existing,
      status: 'CANCELLED',
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      currentStage: 'Cancelled by user',
      message: 'Analysis run was cancelled.',
    };
    storeJob(updated);
    return updated;
  }
  return existing;
}
