import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildServerCapabilities } from '@/server/capabilities-service';
import {
  buildDuplicatedFarmDraft,
  buildReportEnvelopeFromEvaluation,
  ChatStorageAdapter,
  exportFarmBackupBundle,
  isBuiltInResearchSite,
  parseAndValidateBackupBundle,
  ReportStorageAdapter,
} from '@/adapters/storage-adapters';
import {
  DEFAULT_UPPSALA_FARM_DRAFT,
  m4SourceCoverageRepository,
  recordedM14Repository,
} from '@/adapters/repositories';
import { computeDraftInputRevision } from '@/domain/schemas';
import { buildReportPdfBytes, sanitizePdfText } from '@/lib/pdf-report';
import { GET as getCapabilitiesRoute } from '../app/api/capabilities/route';
import { POST as postFarmAnalysisRoute } from '../app/api/farms/[farmId]/analyses/route';
import {
  DELETE as deleteAnalysisJobRoute,
  GET as getAnalysisJobRoute,
} from '../app/api/analyses/[jobId]/route';
import { POST as postReportChatRoute } from '../app/api/reports/[reportId]/chat/route';
import { POST as postReportPdfRoute } from '../app/api/reports/pdf/route';

function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function makeCustomNyeriDraft() {
  const cloned = structuredClone(DEFAULT_UPPSALA_FARM_DRAFT);
  cloned.id = 'nyeri-kenya';
  cloned.name = 'Nyeri Highland Reference (Kenya)';
  cloned.site = {
    ...cloned.site,
    longitude: 36.9476,
    latitude: -0.4201,
    locationLabel: 'Nyeri Highland Reference, Kenya',
    countryCode: 'KE',
    regionName: 'Central Kenya Highlands',
  };
  return cloned;
}

describe('Farmer-First UX Contracts, Offline Truthfulness, PDF Binary & State Isolation', () => {
  it('capabilities endpoint honestly distinguishes available offline capabilities from disconnected backend features', async () => {
    const cap = buildServerCapabilities();
    expect(cap.coverageLookup.enabled).toBe(true);
    expect(cap.recordedM14.enabled).toBe(true);
    expect(cap.pdfExport.enabled).toBe(true);
    expect(cap.liveFarmAnalysis.enabled).toBe(false);
    expect(cap.liveFarmAnalysis.mode).toBe('RECORDED_OR_DEMO_ONLY');
    expect(cap.reportGroundedChat.enabled).toBe(false);
    expect(cap.reportGroundedChat.mode).toBe('NOT_CONNECTED');
    expect(cap.cloudFarmStorage.enabled).toBe(false);
    expect(cap.cloudFarmStorage.mode).toBe('LOCAL_DEVICE_ONLY');

    const res = await getCapabilitiesRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reportGroundedChat.enabled).toBe(false);
    expect(body.pdfExport.enabled).toBe(true);
  });

  it('builds strictly scoped ReportEnvelope for Uppsala Recorded vs Nyeri coverage-only without cross-site leakage', () => {
    const uppsalaReport = buildReportEnvelopeFromEvaluation({
      farm: DEFAULT_UPPSALA_FARM_DRAFT,
      repository: recordedM14Repository,
      datasetMode: 'RECORDED_M14_RESEARCH',
      jobId: 'job-uppsala-test',
    });

    expect(uppsalaReport.dataAvailabilityClass).toBe('VERIFIED_RECORDED_CORPUS');
    expect(uppsalaReport.recommendationNotice).toMatch(/No tested rotation passed the 100 mm/i);
    expect(uppsalaReport.waterBalanceChart.length).toBeGreaterThanOrEqual(2);
    expect(uppsalaReport.scientificNotes.some((n) => /Protocol SHA-256/i.test(n))).toBe(true);

    const nyeriReport = buildReportEnvelopeFromEvaluation({
      farm: makeCustomNyeriDraft(),
      repository: m4SourceCoverageRepository,
      datasetMode: 'RECORDED_M14_RESEARCH',
      jobId: 'job-nyeri-test',
    });

    expect(nyeriReport.dataAvailabilityClass).toBe('COVERAGE_ONLY');
    expect(nyeriReport.recommendationNotice).toMatch(/no crop recommendation available/i);
    expect(nyeriReport.waterBalanceChart).toHaveLength(0);
    expect(JSON.stringify(nyeriReport)).not.toContain('P04');
    expect(JSON.stringify(nyeriReport)).not.toContain('38,420.50');
  });

  it('generates valid multi-page %PDF-1.4 documents with xref offsets, explicit banners, and unit modes', () => {
    expect(sanitizePdfText('Uppsala — 59.86°N · m³ → test (1)')).toContain('deg');
    const uppsalaReport = buildReportEnvelopeFromEvaluation({
      farm: DEFAULT_UPPSALA_FARM_DRAFT,
      repository: recordedM14Repository,
      datasetMode: 'RECORDED_M14_RESEARCH',
      jobId: 'job-pdf-test',
    });

    const metricBytes = buildReportPdfBytes(uppsalaReport, 'SI_METRIC');
    const metricText = decodeAscii(metricBytes);
    expect(metricText.startsWith('%PDF-1.4')).toBe(true);
    expect(metricText.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(metricText).toContain('xref');
    expect(metricText).toContain('/Type /Page');
    expect(metricText).toContain('RECORDED M14 SCIENTIFIC ARCHIVE');
    expect(metricText).toContain('24.00 ha');

    const equivBytes = buildReportPdfBytes(uppsalaReport, 'SI_WITH_ACRE_GALLON_EQUIV');
    const equivText = decodeAscii(equivBytes);
    expect(equivText).toContain('acres');

    const nyeriDraft = makeCustomNyeriDraft();
    nyeriDraft.fields = [];
    const noAreaReport = buildReportEnvelopeFromEvaluation({
      farm: nyeriDraft,
      repository: m4SourceCoverageRepository,
      datasetMode: 'RECORDED_M14_RESEARCH',
      jobId: 'job-pdf-nyeri',
    });
    const noAreaText = decodeAscii(buildReportPdfBytes(noAreaReport, 'SI_METRIC'));
    expect(noAreaText).toContain('EVIDENCE AVAILABILITY REPORT -- NO CROP RECOMMENDATION AVAILABLE');
    expect(noAreaText).toContain('Not declared \\(coordinates only\\)');
  });

  it('protects immutable research examples, validates backup JSON checksums, and flags stale report revisions', () => {
    expect(isBuiltInResearchSite('uppsala-demo')).toBe(true);
    expect(isBuiltInResearchSite('nyeri-kenya')).toBe(true);
    expect(isBuiltInResearchSite('custom-south-field')).toBe(false);

    const copy = buildDuplicatedFarmDraft(DEFAULT_UPPSALA_FARM_DRAFT, ['uppsala-demo'], 'My Uppsala Copy');
    expect(isBuiltInResearchSite(copy.id)).toBe(false);
    expect(copy.isUserCreatedDraft).toBe(true);
    expect(copy.derivedFromFixtureId).toBe('uppsala-demo');

    const copyReport = buildReportEnvelopeFromEvaluation({
      farm: copy,
      repository: recordedM14Repository,
      datasetMode: 'RECORDED_M14_RESEARCH',
      jobId: 'job-copy-snap',
    });

    expect(ReportStorageAdapter.isReportStale(copyReport, copy)).toBe(false);

    const editedCopy = structuredClone(copy);
    editedCopy.fields[0] = {
      ...editedCopy.fields[0]!,
      declaredAreaHa: 18.5,
    };
    editedCopy.inputRevision = computeDraftInputRevision(editedCopy);
    expect(ReportStorageAdapter.isReportStale(copyReport, editedCopy)).toBe(true);

    const bundle = exportFarmBackupBundle({
      farms: {
        'uppsala-demo': DEFAULT_UPPSALA_FARM_DRAFT,
        [copy.id]: copy,
      },
      archivedFarmIds: ['uppsala-demo', copy.id],
      reports: [copyReport],
    });

    expect(Object.keys(bundle.farms)).toEqual([copy.id]);
    expect(bundle.archivedFarmIds).toEqual([copy.id]);

    const verified = parseAndValidateBackupBundle(JSON.stringify(bundle));
    expect(verified.ok).toBe(true);

    const tampered = structuredClone(bundle);
    tampered.farms[copy.id]!.name = 'Tampered Name';
    const rejected = parseAndValidateBackupBundle(JSON.stringify(tampered));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toMatch(/checksum mismatch/i);
    }
  });

  it('strictly isolates Ask ASTRAGRON threads by (farmId, reportId, inputRevision) and returns 503 offline', async () => {
    const keyA = ChatStorageAdapter.buildThreadKey('farm-1', 'rep-A', 'rev-1');
    const keyB = ChatStorageAdapter.buildThreadKey('farm-1', 'rep-B', 'rev-1');
    const keyRev2 = ChatStorageAdapter.buildThreadKey('farm-1', 'rep-A', 'rev-2');
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyRev2);

    const mismatchReq = new NextRequest('http://localhost/api/reports/rep-A/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmId: 'farm-1',
        reportId: 'rep-B',
        inputRevision: 'rev-1',
        evidenceVersion: 'v1',
        conversationId: 'conv-1',
        question: 'Why was no crop chosen?',
      }),
    });
    const mismatchRes = await postReportChatRoute(mismatchReq, {
      params: Promise.resolve({ reportId: 'rep-A' }),
    });
    expect(mismatchRes.status).toBe(409);

    const validOfflineReq = new NextRequest('http://localhost/api/reports/rep-A/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmId: 'farm-1',
        reportId: 'rep-A',
        inputRevision: 'rev-1',
        evidenceVersion: 'v1',
        conversationId: 'conv-1',
        question: 'Explain why drought matters here',
      }),
    });
    const offlineRes = await postReportChatRoute(validOfflineReq, {
      params: Promise.resolve({ reportId: 'rep-A' }),
    });
    expect(offlineRes.status).toBe(503);
    const offlineJson = await offlineRes.json();
    expect(offlineJson.ok).toBe(false);
    expect(offlineJson.status).toBe('CHAT_NOT_CONNECTED');
    expect(offlineJson.answer).toBeNull();
  });

  it('handles analysis trigger/status/cancel and server PDF export routes truthfully without fake timers', async () => {
    const customReq = new NextRequest('http://localhost/api/farms/custom-north/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmId: 'custom-north',
        inputRevision: 'rev-1234',
        datasetMode: 'RECORDED_M14_RESEARCH',
        coordinates: [17.6389, 59.8586],
        fieldCount: 2,
        inputsModified: true,
        isUserCreatedDraft: true,
      }),
    });
    const jobRes = await postFarmAnalysisRoute(customReq, {
      params: Promise.resolve({ farmId: 'custom-north' }),
    });
    expect(jobRes.status).toBe(200);
    const jobJson = await jobRes.json();
    expect(jobJson.ok).toBe(true);
    expect(jobJson.job.progressMode).toBe('INDETERMINATE');
    expect(jobJson.job.status).toBe('COMPLETED_LIMITED');
    expect(jobJson.job.failClosedStatus).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');

    const getRes = await getAnalysisJobRoute(
      new NextRequest(`http://localhost/api/analyses/${jobJson.job.jobId}`),
      { params: Promise.resolve({ jobId: jobJson.job.jobId }) }
    );
    expect(getRes.status).toBe(200);

    const cancelRes = await deleteAnalysisJobRoute(
      new NextRequest(`http://localhost/api/analyses/${jobJson.job.jobId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ jobId: jobJson.job.jobId }) }
    );
    expect(cancelRes.status).toBe(200);
    const cancelJson = await cancelRes.json();
    expect(cancelJson.job.status).toBe('CANCELLED');

    const rep = buildReportEnvelopeFromEvaluation({
      farm: DEFAULT_UPPSALA_FARM_DRAFT,
      repository: recordedM14Repository,
      datasetMode: 'RECORDED_M14_RESEARCH',
      jobId: jobJson.job.jobId,
    });
    const pdfReq = new NextRequest('http://localhost/api/reports/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report: rep, unitMode: 'SI_METRIC' }),
    });
    const pdfRes = await postReportPdfRoute(pdfReq);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    const arrayBuf = await pdfRes.arrayBuffer();
    expect(decodeAscii(new Uint8Array(arrayBuf)).startsWith('%PDF-1.4')).toBe(true);
  });
});
