import { z } from 'zod';
import {
  ChatProxyRequestSchema,
  type ChatProxyRequest,
  type ChatProxyResponse,
} from '@/domain/farmer-ux-contracts';
import { UPPSALA_REFERENCE_INPUT_REVISION } from '@/fixtures/sites-and-coverage';
import { loadAndVerifyStagedCorpora } from './corpus-integrity';
import { getPersistedReportContext, verifyOwnerToken } from './persisted-runtime-store';
import { validateAllowlistedHttpsUrl } from './ssrf-guard';

export interface ServerVerifiedReportContext {
  reportId: string;
  farmId: string;
  ownerId: string;
  inputRevision: string;
  evidenceVersion: string;
  allowedCitationIds: string[];
  evidenceFacts: Record<string, unknown>;
}

const UPPSALA_CANONICAL_CITATION_IDS = [
  'M14_CORPUS_SE_UPPSALA',
  'STAGE1_BARLEY_083',
  'STAGE1_OATS_083',
  'STAGE1_WHEAT_067',
  'SMHI_GRID_P1D',
  'S2_L2A_10M',
  'ERA5_LAND_HOURLY',
  'SOILGRIDS_250M',
  'LPIS_SE_2025',
] as const;

const serverReportRegistry = new Map<string, ServerVerifiedReportContext>();
const conversationBindings = new Map<
  string,
  { reportId: string; farmId: string; inputRevision: string; ownerId: string }
>();
const rateLimitWindows = new Map<string, number[]>();

const UpstreamChatResponseSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  citations: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  reportId: z.string().trim().min(1).max(120),
  inputRevision: z.string().trim().min(1).max(120),
  evidenceVersion: z.string().trim().min(1).max(120),
});

export function registerServerVerifiedReportContext(ctx: ServerVerifiedReportContext): void {
  serverReportRegistry.set(ctx.reportId, {
    ...ctx,
    allowedCitationIds: [...new Set(ctx.allowedCitationIds)],
  });
}

export function clearChatGatewayStateForTests(): void {
  serverReportRegistry.clear();
  conversationBindings.clear();
  rateLimitWindows.clear();
}

export function evaluateChatGatewayReadiness(overrides?: {
  endpointUrl?: string;
  allowedHosts?: string[];
  enableVerifiedGateway?: boolean;
}): {
  enabled: boolean;
  mode: 'CONNECTED' | 'NOT_CONNECTED';
  reason: string;
  validatedUrl: URL | null;
} {
  const rawEndpoint =
    overrides?.endpointUrl ?? process.env.ASTRAGRON_CHAT_ENDPOINT?.trim() ?? '';
  const allowedHosts =
    overrides?.allowedHosts ??
    (process.env.ASTRAGRON_CHAT_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  const enableVerifiedGateway =
    overrides?.enableVerifiedGateway ??
    process.env.ASTRAGRON_CHAT_ENABLE_VERIFIED_GATEWAY === '1';

  if (!rawEndpoint) {
    return {
      enabled: false,
      mode: 'NOT_CONNECTED',
      reason:
        'Ask ASTRAGRON is unavailable until a verified report-grounded analysis assistant backend is connected.',
      validatedUrl: null,
    };
  }

  if (allowedHosts.length === 0) {
    return {
      enabled: false,
      mode: 'NOT_CONNECTED',
      reason:
        'ASTRAGRON_CHAT_ALLOWED_HOSTS is required before enabling external report-grounded chat transport.',
      validatedUrl: null,
    };
  }

  const check = validateAllowlistedHttpsUrl(rawEndpoint, allowedHosts, 'chat assistant');
  if (!check.valid) {
    return {
      enabled: false,
      mode: 'NOT_CONNECTED',
      reason: check.reason,
      validatedUrl: null,
    };
  }

  if (!enableVerifiedGateway) {
    return {
      enabled: false,
      mode: 'NOT_CONNECTED',
      reason:
        'Report-grounded chat gateway remains fail-closed until ASTRAGRON_CHAT_ENABLE_VERIFIED_GATEWAY=1 and server-side report authentication are enabled.',
      validatedUrl: null,
    };
  }

  return {
    enabled: true,
    mode: 'CONNECTED',
    reason: 'Verified HTTPS report-grounded chat gateway connected with server citation enforcement.',
    validatedUrl: check.url,
  };
}

function resolveVerifiedReportContext(params: {
  urlReportId: string;
  request: ChatProxyRequest;
  callerOwnerId?: string | null;
  callerOwnerToken?: string | null;
  requireSignedOwnerToken?: boolean;
}):
  | { ok: true; context: ServerVerifiedReportContext }
  | {
      ok: false;
      httpStatus: number;
      status: ChatProxyResponse['status'];
      reason: string;
    } {
  const { urlReportId, request, callerOwnerId, callerOwnerToken, requireSignedOwnerToken } = params;

  if (urlReportId !== request.reportId) {
    return {
      ok: false,
      httpStatus: 409,
      status: 'REPORT_CONTEXT_MISMATCH',
      reason:
        'URL reportId does not match request body reportId. Start a new thread for the current report.',
    };
  }

  // 1. Check server-registered report contexts (in-memory or disk-persisted across restarts)
  let registered = serverReportRegistry.get(urlReportId);
  if (!registered) {
    const fromDisk = getPersistedReportContext(urlReportId);
    if (fromDisk) {
      registered = fromDisk;
      serverReportRegistry.set(urlReportId, fromDisk);
    }
  }
  if (registered) {
    if (
      requireSignedOwnerToken &&
      (!callerOwnerId || !callerOwnerToken || !verifyOwnerToken(callerOwnerToken, callerOwnerId.trim(), urlReportId))
    ) {
      return {
        ok: false,
        httpStatus: 403,
        status: 'REPORT_CONTEXT_MISMATCH',
        reason:
          'Server report ownership verification failed: missing or invalid HMAC owner authorization token.',
      };
    }
    if (!callerOwnerId || callerOwnerId.trim() !== registered.ownerId) {
      return {
        ok: false,
        httpStatus: 403,
        status: 'REPORT_CONTEXT_MISMATCH',
        reason:
          'Server report ownership verification failed: missing or mismatched owner identity for this report.',
      };
    }
    if (request.farmId !== registered.farmId) {
      return {
        ok: false,
        httpStatus: 409,
        status: 'REPORT_CONTEXT_MISMATCH',
        reason: 'Cross-report or cross-farm context mismatch detected.',
      };
    }
    if (request.inputRevision !== registered.inputRevision) {
      return {
        ok: false,
        httpStatus: 409,
        status: 'REPORT_CONTEXT_MISMATCH',
        reason:
          'Stale report revision: farm geometry or crop inputs changed after this report was generated.',
      };
    }
    if (request.evidenceVersion !== registered.evidenceVersion) {
      return {
        ok: false,
        httpStatus: 409,
        status: 'REPORT_CONTEXT_MISMATCH',
        reason: 'Report evidenceVersion does not match the server-verified report archive.',
      };
    }
    return { ok: true, context: registered };
  }

  // 2. Check immutable server-verified Uppsala M14 reference report context
  if (request.farmId === 'uppsala-demo' || request.farmId === 'uppsala-m14') {
    if (request.inputRevision !== UPPSALA_REFERENCE_INPUT_REVISION) {
      return {
        ok: false,
        httpStatus: 409,
        status: 'REPORT_CONTEXT_MISMATCH',
        reason:
          'Stale or modified Uppsala inputRevision: recorded M14 evidence only applies to the unmodified reference revision.',
      };
    }
    const corpus = loadAndVerifyStagedCorpora();
    if (!corpus.verified) {
      return {
        ok: false,
        httpStatus: 503,
        status: 'CHAT_NOT_CONNECTED',
        reason: `Uppsala M14 server corpus integrity check failed: ${corpus.reason}`,
      };
    }
    const isUppsalaReportId =
      urlReportId === 'report-uppsala-m14-baseline' ||
      urlReportId.startsWith('report-uppsala-demo');
    if (!isUppsalaReportId) {
      return {
        ok: false,
        httpStatus: 409,
        status: 'REPORT_CONTEXT_MISMATCH',
        reason: 'Report ID does not belong to the verified Uppsala reference archive.',
      };
    }
    return {
      ok: true,
      context: {
        reportId: urlReportId,
        farmId: request.farmId,
        ownerId: callerOwnerId?.trim() || 'public-uppsala-reference',
        inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
        evidenceVersion: request.evidenceVersion,
        allowedCitationIds: [...UPPSALA_CANONICAL_CITATION_IDS],
        evidenceFacts: {
          canonicalSiteId: 'SE_UPPSALA',
          coordinates: [17.6389, 59.8586],
          universallyQualifiedPlansCount: 0,
          conditionalCandidates: [
            { crop: 'Spring Barley', stage1QualificationRate: 0.8333, citationId: 'STAGE1_BARLEY_083' },
            { crop: 'Spring Oats', stage1QualificationRate: 0.8333, citationId: 'STAGE1_OATS_083' },
            { crop: 'Winter Wheat', stage1QualificationRate: 0.6667, citationId: 'STAGE1_WHEAT_067' },
          ],
        },
      },
    };
  }

  // 3. Any unpersisted custom farm report (LOCAL_DEVICE_ONLY) cannot be verified by the server
  return {
    ok: false,
    httpStatus: 503,
    status: 'CHAT_NOT_CONNECTED',
    reason:
      'Custom farm reports are stored locally on your device (LOCAL_DEVICE_ONLY) without server-side persistence or ownership verification. Ask ASTRAGRON refuses to answer from unverified client-supplied report state.',
  };
}

function checkRateLimit(
  key: string,
  nowMs: number,
  windowMs: number,
  maxRequests: number
): boolean {
  const existing = rateLimitWindows.get(key) ?? [];
  const active = existing.filter((ts) => nowMs - ts < windowMs);
  if (active.length >= maxRequests) {
    rateLimitWindows.set(key, active);
    return false;
  }
  active.push(nowMs);
  rateLimitWindows.set(key, active);
  return true;
}

export async function handleReportGroundedChatRequest(params: {
  urlReportId: string;
  rawBody: unknown;
  callerOwnerId?: string | null;
  callerOwnerToken?: string | null;
  requireSignedOwnerToken?: boolean;
  clientKey?: string;
  overrides?: {
    endpointUrl?: string;
    allowedHosts?: string[];
    enableVerifiedGateway?: boolean;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxRequestsPerWindow?: number;
    rateLimitWindowMs?: number;
    nowMs?: () => number;
  };
}): Promise<{ httpStatus: number; body: ChatProxyResponse }> {
  const parsed = ChatProxyRequestSchema.safeParse(params.rawBody);
  if (!parsed.success) {
    return {
      httpStatus: 400,
      body: {
        ok: false,
        status: 'INVALID_REQUEST',
        answer: null,
        citations: [],
        reason: 'Invalid chat request payload.',
      },
    };
  }

  const req = parsed.data;
  const nowMs = params.overrides?.nowMs ? params.overrides.nowMs() : Date.now();
  const windowMs = params.overrides?.rateLimitWindowMs ?? 60_000;
  const maxRequests = params.overrides?.maxRequestsPerWindow ?? 10;
  const rateKey = (params.clientKey || params.callerOwnerId || req.conversationId).trim();

  if (!checkRateLimit(rateKey, nowMs, windowMs, maxRequests)) {
    return {
      httpStatus: 429,
      body: {
        ok: false,
        status: 'INVALID_REQUEST',
        answer: null,
        citations: [],
        reason: 'Chat rate limit exceeded. Please wait before sending another question.',
      },
    };
  }

  // Verify report ownership, farmId, inputRevision, and server-side evidence context first
  const resolved = resolveVerifiedReportContext({
    urlReportId: params.urlReportId,
    request: req,
    callerOwnerId: params.callerOwnerId,
    callerOwnerToken: params.callerOwnerToken,
    requireSignedOwnerToken: params.requireSignedOwnerToken,
  });
  if (!resolved.ok) {
    return {
      httpStatus: resolved.httpStatus,
      body: {
        ok: false,
        status: resolved.status,
        answer: null,
        citations: [],
        reason: resolved.reason,
      },
    };
  }

  const verifiedContext = resolved.context;

  // Enforce conversation thread binding so a conversationId cannot be hijacked across reports or revisions
  const existingBinding = conversationBindings.get(req.conversationId);
  if (existingBinding) {
    if (
      existingBinding.reportId !== verifiedContext.reportId ||
      existingBinding.farmId !== verifiedContext.farmId ||
      existingBinding.inputRevision !== verifiedContext.inputRevision ||
      existingBinding.ownerId !== verifiedContext.ownerId
    ) {
      return {
        httpStatus: 409,
        body: {
          ok: false,
          status: 'REPORT_CONTEXT_MISMATCH',
          answer: null,
          citations: [],
          reason:
            'Conversation thread is bound to a different report, farm, or inputRevision. Start a new conversation for this report.',
        },
      };
    }
  } else {
    conversationBindings.set(req.conversationId, {
      reportId: verifiedContext.reportId,
      farmId: verifiedContext.farmId,
      inputRevision: verifiedContext.inputRevision,
      ownerId: verifiedContext.ownerId,
    });
  }

  // Verify upstream HTTPS + host allowlist + explicit gateway activation
  const readiness = evaluateChatGatewayReadiness({
    endpointUrl: params.overrides?.endpointUrl,
    allowedHosts: params.overrides?.allowedHosts,
    enableVerifiedGateway: params.overrides?.enableVerifiedGateway,
  });

  if (!readiness.enabled || !readiness.validatedUrl) {
    return {
      httpStatus: 503,
      body: {
        ok: false,
        status: 'CHAT_NOT_CONNECTED',
        answer: null,
        citations: [],
        reason: readiness.reason,
      },
    };
  }

  const fetchFn = params.overrides?.fetchImpl ?? fetch;
  const timeoutMs =
    params.overrides?.timeoutMs ??
    (Number(process.env.ASTRAGRON_CHAT_TIMEOUT_MS) > 0
      ? Number(process.env.ASTRAGRON_CHAT_TIMEOUT_MS)
      : 6000);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const upstreamRes = await fetchFn(readiness.validatedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: ac.signal,
      body: JSON.stringify({
        systemPolicy:
          'ANSWER_ONLY_FROM_VERIFIED_SERVER_EVIDENCE_NEVER_FABRICATE_NUMBERS_OR_CITATIONS',
        reportContext: {
          reportId: verifiedContext.reportId,
          farmId: verifiedContext.farmId,
          inputRevision: verifiedContext.inputRevision,
          evidenceVersion: verifiedContext.evidenceVersion,
          allowedCitationIds: verifiedContext.allowedCitationIds,
          evidenceFacts: verifiedContext.evidenceFacts,
        },
        conversationId: req.conversationId,
        userQuestion: req.question,
      }),
    });

    if (!upstreamRes.ok) {
      return {
        httpStatus: 503,
        body: {
          ok: false,
          status: 'CHAT_NOT_CONNECTED',
          answer: null,
          citations: [],
          reason: `Report-grounded assistant backend returned HTTP ${upstreamRes.status}.`,
        },
      };
    }

    const rawJson = await upstreamRes.json().catch(() => null);
    const validatedUpstream = UpstreamChatResponseSchema.safeParse(rawJson);
    if (!validatedUpstream.success) {
      return {
        httpStatus: 503,
        body: {
          ok: false,
          status: 'CHAT_NOT_CONNECTED',
          answer: null,
          citations: [],
          reason:
            'Upstream assistant response failed strict schema validation; refusing to display unverified output.',
        },
      };
    }

    const data = validatedUpstream.data;
    if (
      data.reportId !== verifiedContext.reportId ||
      data.inputRevision !== verifiedContext.inputRevision ||
      data.evidenceVersion !== verifiedContext.evidenceVersion
    ) {
      return {
        httpStatus: 409,
        body: {
          ok: false,
          status: 'REPORT_CONTEXT_MISMATCH',
          answer: null,
          citations: [],
          reason:
            'Upstream assistant response context (reportId, inputRevision, or evidenceVersion) did not match the server-verified report.',
        },
      };
    }

    const allowedSet = new Set(verifiedContext.allowedCitationIds);
    const hasUnverifiedCitation = data.citations.some((cid) => !allowedSet.has(cid));
    if (hasUnverifiedCitation) {
      return {
        httpStatus: 503,
        body: {
          ok: false,
          status: 'CHAT_NOT_CONNECTED',
          answer: null,
          citations: [],
          reason:
            'Upstream assistant cited evidence IDs not present in the server-verified report archive; response blocked.',
        },
      };
    }

    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: 'OK',
        answer: data.answer,
        citations: data.citations,
        reason: 'Verified report-grounded response with server-validated citations.',
      },
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      httpStatus: 503,
      body: {
        ok: false,
        status: 'CHAT_NOT_CONNECTED',
        answer: null,
        citations: [],
        reason: isTimeout
          ? `Report-grounded assistant timed out after ${timeoutMs} ms.`
          : 'Report-grounded assistant endpoint was unreachable or rejected redirect/TLS.',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
