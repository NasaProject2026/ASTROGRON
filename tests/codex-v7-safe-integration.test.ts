import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { evaluateSiteCapabilityCheck } from '@/server/capability-overlay-service';
import {
  createAnalysisJob,
  createAndDispatchAnalysisJob,
  cancelAnalysisJob,
} from '@/server/analysis-job-store';
import {
  clearChatGatewayStateForTests,
  evaluateChatGatewayReadiness,
  handleReportGroundedChatRequest,
  registerServerVerifiedReportContext,
} from '@/server/chat-gateway-service';
import { buildServerCapabilities } from '@/server/capabilities-service';
import { UPPSALA_REFERENCE_INPUT_REVISION } from '@/fixtures/sites-and-coverage';
import { POST as postChatRoute } from '../app/api/reports/[reportId]/chat/route';

describe('ASTRAGRON V7 Codex Safe Integration Gate Suite (G2–G6)', () => {
  beforeEach(() => {
    clearChatGatewayStateForTests();
  });

  describe('Gate G2: Zero Benchmark Eligibility Leakage', () => {
    const benchmarkCoords: Array<readonly [string, string, [number, number]]> = [
      ['Uppsala M14', 'uppsala-demo', [17.6389, 59.8586]],
      ['Nyeri M4', 'nyeri-kenya', [36.9476, -0.4201]],
      ['Wagga Wagga M4', 'wagga-australia', [147.3598, -35.1082]],
      ['Svalbard Polar', 'polar-svalbard', [15.6397, 78.2232]],
      ['North Atlantic', 'ocean-atlantic', [-30.0, 45.0]],
    ];

    it('returns UNKNOWN_UNASSESSED when a custom farm has exact benchmark coordinates', async () => {
      for (const [label, , coords] of benchmarkCoords) {
        const noIdRes = await evaluateSiteCapabilityCheck({
          coordinates: [coords[0], coords[1]],
        });
        expect(noIdRes.status, `${label} without farmId`).toBe('UNKNOWN_UNASSESSED');

        const customIdRes = await evaluateSiteCapabilityCheck({
          coordinates: [coords[0], coords[1]],
          farmId: 'custom-farmer-field-1',
          inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
        });
        expect(customIdRes.status, `${label} with custom-farmId`).toBe('UNKNOWN_UNASSESSED');
      }
    });

    it('returns UNKNOWN_UNASSESSED for 0.0001 deg, 0.0005 deg, and 0.5 km offsets even with benchmark farmId', async () => {
      const offsets = [0.0001, 0.0005, 0.0045]; // ~11m, ~55m, ~500m
      for (const [label, farmId, coords] of benchmarkCoords) {
        for (const delta of offsets) {
          const res = await evaluateSiteCapabilityCheck({
            coordinates: [coords[0] + delta, coords[1]],
            farmId,
            inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          });
          expect(res.status, `${label} offset by ${delta} deg`).toBe('UNKNOWN_UNASSESSED');
        }
      }
    });

    it('returns UNKNOWN_UNASSESSED when a user polygon encloses a benchmark point', async () => {
      const enclosingUppsalaPolygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [17.635, 59.855],
            [17.642, 59.855],
            [17.642, 59.862],
            [17.635, 59.862],
            [17.635, 59.855],
          ],
        ],
      };

      const res = await evaluateSiteCapabilityCheck({
        coordinates: [17.6389, 59.8586],
        geometry: enclosingUppsalaPolygon,
        farmId: 'uppsala-demo',
        inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
      });
      expect(res.status).toBe('UNKNOWN_UNASSESSED');
    });

    it('requires UPPSALA_REFERENCE_INPUT_REVISION and unmodified state for uppsala-demo benchmark eligibility', async () => {
      const missingRev = await evaluateSiteCapabilityCheck({
        coordinates: [17.6389, 59.8586],
        farmId: 'uppsala-demo',
      });
      expect(missingRev.status).toBe('UNKNOWN_UNASSESSED');

      const staleRev = await evaluateSiteCapabilityCheck({
        coordinates: [17.6389, 59.8586],
        farmId: 'uppsala-demo',
        inputRevision: 'rev-modified-99999999',
      });
      expect(staleRev.status).toBe('UNKNOWN_UNASSESSED');

      const validUppsala = await evaluateSiteCapabilityCheck({
        coordinates: [17.6389, 59.8586],
        farmId: 'uppsala-demo',
        inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
        isUserModifiedDraft: false,
        isUserCreatedDraft: false,
      });
      expect(validUppsala.status).toBe('RESEARCH_ONLY');
    });
  });

  describe('Gate G3: Science-Backed Analysis Job Store Hardening', () => {
    it('blocks spoofed uppsala-demo analysis requests with wrong inputRevision, coordinates, or fieldCount', () => {
      const spoofedRevision = createAnalysisJob('uppsala-demo', {
        farmId: 'uppsala-demo',
        inputRevision: 'rev-spoofed-custom',
        datasetMode: 'RECORDED_M14_RESEARCH',
        coordinates: [17.6389, 59.8586],
        fieldCount: 3,
        inputsModified: false,
        isUserCreatedDraft: false,
      });
      expect(spoofedRevision.status).toBe('COMPLETED_LIMITED');
      expect(spoofedRevision.failClosedStatus).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');

      const spoofedCoords = createAnalysisJob('uppsala-demo', {
        farmId: 'uppsala-demo',
        inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
        datasetMode: 'RECORDED_M14_RESEARCH',
        coordinates: [9.14156, 48.98443],
        fieldCount: 3,
        inputsModified: false,
        isUserCreatedDraft: false,
      });
      expect(spoofedCoords.status).toBe('COMPLETED_LIMITED');
      expect(spoofedCoords.failClosedStatus).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');

      const validUppsala = createAnalysisJob('uppsala-demo', {
        farmId: 'uppsala-demo',
        inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
        datasetMode: 'RECORDED_M14_RESEARCH',
        coordinates: [17.6389, 59.8586],
        fieldCount: 3,
        inputsModified: false,
        isUserCreatedDraft: false,
      });
      expect(validUppsala.status).toBe('ABSTAINED');
      expect(validUppsala.failClosedStatus).toBe('OK_RECORDED_RESEARCH');
    });

    it('enforces active-job idempotency and rejects upstream COMPLETED_VERIFIED without bound provenance', async () => {
      let fetchCalls = 0;
      const queuedJob = await createAndDispatchAnalysisJob(
        'custom-idem-1',
        {
          farmId: 'custom-idem-1',
          inputRevision: 'rev-idem-1',
          datasetMode: 'REAL_SCIENTIFIC_BACKEND',
          coordinates: [9.14156, 48.98443],
          fieldCount: 1,
        },
        {
          backendUrl: 'https://engine.astragron.org',
          allowedHosts: ['engine.astragron.org'],
          fetchImpl: async () => {
            fetchCalls += 1;
            return new Response(
              JSON.stringify({
                jobId: 'job-upstream-idem-1',
                status: 'RUNNING',
                currentStage: 'Executing hydrology stage',
              }),
              { status: 200 }
            );
          },
        }
      );
      expect(queuedJob.status).toBe('RUNNING');
      expect(fetchCalls).toBe(1);

      const duplicateCall = await createAndDispatchAnalysisJob(
        'custom-idem-1',
        {
          farmId: 'custom-idem-1',
          inputRevision: 'rev-idem-1',
          datasetMode: 'REAL_SCIENTIFIC_BACKEND',
          coordinates: [9.14156, 48.98443],
          fieldCount: 1,
        },
        {
          backendUrl: 'https://engine.astragron.org',
          allowedHosts: ['engine.astragron.org'],
          fetchImpl: async () => {
            fetchCalls += 1;
            return new Response(JSON.stringify({ status: 'RUNNING' }), { status: 200 });
          },
        }
      );
      expect(duplicateCall.jobId).toBe(queuedJob.jobId);
      expect(fetchCalls).toBe(1);
      cancelAnalysisJob(queuedJob.jobId);

      // Fake COMPLETED_VERIFIED without bound inputRevision/evidenceVerified must be rejected
      const unverifiedUpstream = await createAndDispatchAnalysisJob(
        'custom-unverified-1',
        {
          farmId: 'custom-unverified-1',
          inputRevision: 'rev-unverified-1',
          datasetMode: 'REAL_SCIENTIFIC_BACKEND',
          coordinates: [9.14156, 48.98443],
          fieldCount: 1,
        },
        {
          backendUrl: 'https://engine.astragron.org',
          allowedHosts: ['engine.astragron.org'],
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                jobId: 'job-fake-complete',
                status: 'COMPLETED_VERIFIED',
                reportId: 'rep-fake',
                // Missing matching farmId, inputRevision, and evidenceVerified: true
              }),
              { status: 200 }
            ),
        }
      );
      expect(unverifiedUpstream.status).toBe('FAILED');
      expect(unverifiedUpstream.failClosedStatus).toBe('SOURCE_NOT_PROVIDED');
      expect(unverifiedUpstream.reportId).toBeNull();

      // Verified COMPLETED_VERIFIED with full provenance succeeds
      const verifiedUpstream = await createAndDispatchAnalysisJob(
        'custom-verified-1',
        {
          farmId: 'custom-verified-1',
          inputRevision: 'rev-verified-1',
          datasetMode: 'REAL_SCIENTIFIC_BACKEND',
          coordinates: [9.14156, 48.98443],
          fieldCount: 1,
        },
        {
          backendUrl: 'https://engine.astragron.org',
          allowedHosts: ['engine.astragron.org'],
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                jobId: 'job-real-complete',
                farmId: 'custom-verified-1',
                inputRevision: 'rev-verified-1',
                status: 'COMPLETED_VERIFIED',
                reportId: 'rep-verified-1',
                evidenceVerified: true,
              }),
              { status: 200 }
            ),
        }
      );
      expect(verifiedUpstream.status).toBe('COMPLETED_VERIFIED');
      expect(verifiedUpstream.reportId).toBe('rep-verified-1');
    });
  });

  describe('Gate G4: Secure Report-Grounded AI Chat Gateway', () => {
    it('remains fail-closed by default and does not report Connected without allowlist + verified gateway flag', async () => {
      const caps = buildServerCapabilities();
      expect(caps.reportGroundedChat.enabled).toBe(false);
      expect(caps.reportGroundedChat.mode).toBe('NOT_CONNECTED');

      const missingAllowlist = evaluateChatGatewayReadiness({
        endpointUrl: 'https://chat.astragron.org/v1/ask',
        allowedHosts: [],
        enableVerifiedGateway: true,
      });
      expect(missingAllowlist.enabled).toBe(false);

      const privateIpBlocked = evaluateChatGatewayReadiness({
        endpointUrl: 'https://127.0.0.1/v1/ask',
        allowedHosts: ['127.0.0.1'],
        enableVerifiedGateway: true,
      });
      expect(privateIpBlocked.enabled).toBe(false);

      const routeRes = await postChatRoute(
        new NextRequest('http://localhost:3000/api/reports/report-uppsala-m14-baseline/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            farmId: 'uppsala-demo',
            reportId: 'report-uppsala-m14-baseline',
            inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
            evidenceVersion: '1.0.0-m14-uppsala-baseline',
            conversationId: 'conv-default-closed',
            question: 'Why did zero plans qualify universally?',
          }),
        }),
        { params: Promise.resolve({ reportId: 'report-uppsala-m14-baseline' }) }
      );
      expect(routeRes.status).toBe(503);
      const routeBody = await routeRes.json();
      expect(routeBody.status).toBe('CHAT_NOT_CONNECTED');
    });

    it('enforces server-side report ownership, stale revision rejection, cross-report isolation, and citation verification', async () => {
      registerServerVerifiedReportContext({
        reportId: 'rep-custom-100',
        farmId: 'farm-custom-100',
        ownerId: 'farmer-alice',
        inputRevision: 'rev-alice-v1',
        evidenceVersion: 'ev-alice-v1',
        allowedCitationIds: ['EVID_SOIL_01', 'EVID_WATER_02'],
        evidenceFacts: { deficitMm: 42 },
      });

      // 1. Cross-user access denied (403)
      const crossUser = await handleReportGroundedChatRequest({
        urlReportId: 'rep-custom-100',
        callerOwnerId: 'farmer-mallory',
        rawBody: {
          farmId: 'farm-custom-100',
          reportId: 'rep-custom-100',
          inputRevision: 'rev-alice-v1',
          evidenceVersion: 'ev-alice-v1',
          conversationId: 'conv-1',
          question: 'What is my deficit?',
        },
      });
      expect(crossUser.httpStatus).toBe(403);
      expect(crossUser.body.status).toBe('REPORT_CONTEXT_MISMATCH');

      // 2. Stale inputRevision after geometry/crop edit rejected (409)
      const staleRevision = await handleReportGroundedChatRequest({
        urlReportId: 'rep-custom-100',
        callerOwnerId: 'farmer-alice',
        rawBody: {
          farmId: 'farm-custom-100',
          reportId: 'rep-custom-100',
          inputRevision: 'rev-alice-v2-edited',
          evidenceVersion: 'ev-alice-v1',
          conversationId: 'conv-2',
          question: 'What is my deficit?',
        },
      });
      expect(staleRevision.httpStatus).toBe(409);
      expect(staleRevision.body.status).toBe('REPORT_CONTEXT_MISMATCH');

      // 3. Unverified/hallucinated upstream citation rejected fail-closed (503)
      const hallucinatedCitation = await handleReportGroundedChatRequest({
        urlReportId: 'rep-custom-100',
        callerOwnerId: 'farmer-alice',
        rawBody: {
          farmId: 'farm-custom-100',
          reportId: 'rep-custom-100',
          inputRevision: 'rev-alice-v1',
          evidenceVersion: 'ev-alice-v1',
          conversationId: 'conv-3',
          question: 'What is my deficit?',
        },
        overrides: {
          endpointUrl: 'https://chat.astragron.org/v1/ask',
          allowedHosts: ['chat.astragron.org'],
          enableVerifiedGateway: true,
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                answer: 'Your deficit is 42 mm.',
                citations: ['EVID_SOIL_01', 'HALLUCINATED_CITATION_999'],
                reportId: 'rep-custom-100',
                inputRevision: 'rev-alice-v1',
                evidenceVersion: 'ev-alice-v1',
              }),
              { status: 200 }
            ),
        },
      });
      expect(hallucinatedCitation.httpStatus).toBe(503);
      expect(hallucinatedCitation.body.ok).toBe(false);
      expect(hallucinatedCitation.body.answer).toBeNull();

      // 4. Valid server-verified response with allowlisted citations succeeds (200)
      const validChat = await handleReportGroundedChatRequest({
        urlReportId: 'rep-custom-100',
        callerOwnerId: 'farmer-alice',
        rawBody: {
          farmId: 'farm-custom-100',
          reportId: 'rep-custom-100',
          inputRevision: 'rev-alice-v1',
          evidenceVersion: 'ev-alice-v1',
          conversationId: 'conv-3',
          question: 'What is my deficit?',
        },
        overrides: {
          endpointUrl: 'https://chat.astragron.org/v1/ask',
          allowedHosts: ['chat.astragron.org'],
          enableVerifiedGateway: true,
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                answer: 'Recorded water balance shows a 42 mm deficit.',
                citations: ['EVID_SOIL_01', 'EVID_WATER_02'],
                reportId: 'rep-custom-100',
                inputRevision: 'rev-alice-v1',
                evidenceVersion: 'ev-alice-v1',
              }),
              { status: 200 }
            ),
        },
      });
      expect(validChat.httpStatus).toBe(200);
      expect(validChat.body.ok).toBe(true);
      expect(validChat.body.citations).toEqual(['EVID_SOIL_01', 'EVID_WATER_02']);

      // 5. Rate limiting blocks burst abuse (429)
      const rateBlocked = await handleReportGroundedChatRequest({
        urlReportId: 'rep-custom-100',
        callerOwnerId: 'farmer-alice',
        clientKey: 'burst-client',
        rawBody: {
          farmId: 'farm-custom-100',
          reportId: 'rep-custom-100',
          inputRevision: 'rev-alice-v1',
          evidenceVersion: 'ev-alice-v1',
          conversationId: 'conv-3',
          question: 'Burst question',
        },
        overrides: {
          maxRequestsPerWindow: 0,
        },
      });
      expect(rateBlocked.httpStatus).toBe(429);
    });
  });
});
