// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as postFarmAnalysis } from '../app/api/farms/[farmId]/analyses/route';
import { GET as getAnalysisById } from '../app/api/analyses/[jobId]/route';
import { GET as getFarms, POST as postFarm } from '../app/api/farms/route';
import { GET as getReports } from '../app/api/reports/route';
import { POST as postReportChat } from '../app/api/reports/[reportId]/chat/route';
import { resolveServerCapabilities } from '@/server/capabilities-service';
import { resolveAnalysisBackendUrl } from '@/server/ssrf-guard';
import {
  getPersistedReportContext,
  resetPersistedStoreForTests,
  signOwnerToken,
} from '@/server/persisted-runtime-store';
import { ReportEnvelopeSchema } from '@/domain/farmer-ux-contracts';

function findPythonExecutable(): string | null {
  const cwd = process.cwd();
  const candidates = [
    process.env.ASTRAGRON_PYTHON_BIN,
    path.resolve(cwd, '..', '.venv', 'Scripts', 'python.exe'),
    path.resolve(cwd, '..', '.venv', 'bin', 'python'),
    path.resolve(cwd, '.venv', 'Scripts', 'python.exe'),
    'python',
    'python3',
  ].filter((c): c is string => Boolean(c && c.trim()));

  for (const cand of candidates) {
    const probe = spawnSync(cand, ['-c', 'import adaptive_evidence'], {
      cwd,
      encoding: 'utf8',
      timeout: 8000,
    });
    if (probe.status === 0) {
      return cand;
    }
  }
  return null;
}

const PYTHON_EXECUTABLE = findPythonExecutable();

async function startUnifiedPythonServer(
  pythonExe: string,
  pythonStorePath: string
): Promise<{ child: ChildProcessWithoutNullStreams; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonExe,
      ['-B', '-X', 'utf8', '-m', 'adaptive_evidence.unified_server', '--host', '127.0.0.1', '--port', '0'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ASTRAGRON_OFFLINE_ONLY: '1',
          ASTRAGRON_PYTHON_STORE_PATH: pythonStorePath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore
      }
      reject(new Error(`Timed out waiting for Python unified_server startup. stderr=${stderrBuffer}`));
    }, 15000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      for (const line of stdoutBuffer.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed) as { status?: string; adaptive_api_url?: string };
          if (parsed.status === 'ASTRAGRON_UNIFIED_SERVER_LISTENING' && parsed.adaptive_api_url) {
            clearTimeout(timer);
            const origin = new URL(parsed.adaptive_api_url).origin;
            resolve({ child, baseUrl: origin });
            return;
          }
        } catch {
          // Wait for complete JSON line
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Python unified_server exited prematurely with code ${code}. stderr=${stderrBuffer}`));
    });
  });
}

function makeJsonPostRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!PYTHON_EXECUTABLE)('ASTRAGRON Real End-to-End Next.js <-> Python Scientific Integration', () => {
  let tempDir = '';
  let nextStorePath = '';
  let pythonStorePath = '';
  let pythonUrl = '';
  let pythonChild: ChildProcessWithoutNullStreams | null = null;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'ASTRAGRON_BACKEND_URL',
    'ASTRAGRON_BACKEND_ALLOWED_HOSTS',
    'ASTRAGRON_ALLOW_LOCAL_PYTHON_BACKEND',
    'ASTRAGRON_RUNTIME_STORE_PATH',
    'ASTRAGRON_CHAT_BACKEND_URL',
    'ASTRAGRON_GEOCODER_URL',
  ];

  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astragron-e2e-int-'));
    nextStorePath = path.join(tempDir, 'next-runtime-store.json');
    pythonStorePath = path.join(tempDir, 'python-runtime-store.json');

    const started = await startUnifiedPythonServer(PYTHON_EXECUTABLE!, pythonStorePath);
    pythonChild = started.child;
    pythonUrl = started.baseUrl;

    process.env.ASTRAGRON_BACKEND_URL = pythonUrl;
    process.env.ASTRAGRON_BACKEND_ALLOWED_HOSTS = '127.0.0.1,localhost';
    process.env.ASTRAGRON_ALLOW_LOCAL_PYTHON_BACKEND = '1';
    process.env.ASTRAGRON_RUNTIME_STORE_PATH = nextStorePath;
    delete process.env.ASTRAGRON_CHAT_BACKEND_URL;
    delete process.env.ASTRAGRON_GEOCODER_URL;
    resetPersistedStoreForTests(nextStorePath);
  }, 25000);

  afterAll(() => {
    if (pythonChild && !pythonChild.killed) {
      try {
        pythonChild.kill();
      } catch {
        // Ignore cleanup failures
      }
    }
    for (const k of ENV_KEYS) {
      const prev = savedEnv[k];
      if (prev === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = prev;
      }
    }
    resetPersistedStoreForTests();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows handle linger
    }
  });

  it('SSRF guard permits loopback HTTP only when explicitly enabled, and /health capabilities show BACKEND_CONNECTED', async () => {
    const blockedHttp = resolveAnalysisBackendUrl('http://127.0.0.1:8080/analyses', ['127.0.0.1', 'localhost'], {
      allowLocalPythonBackend: false,
    });
    expect(blockedHttp.valid).toBe(false);

    const remoteHttpCheck = resolveAnalysisBackendUrl('http://example.com:8080/analyses', ['example.com', '127.0.0.1'], {
      allowLocalPythonBackend: true,
    });
    expect(remoteHttpCheck.valid).toBe(false);

    const localAllowed = resolveAnalysisBackendUrl(pythonUrl, ['127.0.0.1', 'localhost'], {
      allowLocalPythonBackend: true,
    });
    expect(localAllowed.valid).toBe(true);

    const caps = await resolveServerCapabilities();
    expect(caps.liveFarmAnalysis.enabled).toBe(true);
    expect(caps.liveFarmAnalysis.mode).toBe('BACKEND_CONNECTED');
    expect(caps.reportGroundedChat.enabled).toBe(false);
    expect(caps.reportGroundedChat.mode).toBe('NOT_CONNECTED');
  });

  it('executes full farmer Heilbronn workflow across Next.js API routes, Python C1-C10 engine, restart persistence, and signed chat fail-closed security', async () => {
    const farmId = 'farm-heilbronn-e2e';
    const inputRevision = 'rev-heilbronn-001';
    const customDraft = {
      id: farmId,
      name: 'Heilbronn Integrated Test Farm',
      createdAt: '2026-11-14T20:00:00Z',
      updatedAt: '2026-11-14T20:00:00Z',
      isUserCreatedDraft: true,
      inputsModified: true,
      site: {
        longitude: 9.22,
        latitude: 49.14,
        crs: 'EPSG:4326' as const,
        locationLabel: 'Heilbronn / Kraichgau, Germany',
        countryCode: 'DE',
        regionName: 'Baden-Wuerttemberg',
        spatialPrecisionNote: 'WGS84 test parcel',
      },
      fields: [
        {
          id: 'F1',
          label: 'South Parcel',
          declaredAreaHa: 14.5,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.218, 49.138],
                [9.222, 49.138],
                [9.222, 49.142],
                [9.218, 49.142],
                [9.218, 49.138],
              ],
            ],
          },
          candidateCrops: ['wheat', 'barley'],
          irrigationAccess: 'NO',
        },
      ],
    };

    const farmSaveRes = await postFarm(makeJsonPostRequest('http://localhost:3000/api/farms', { farm: customDraft }));
    expect(farmSaveRes.status).toBe(200);

    const analysisRes = await postFarmAnalysis(
      makeJsonPostRequest(`http://localhost:3000/api/farms/${farmId}/analyses`, {
        farmId,
        inputRevision,
        datasetMode: 'REAL_SCIENTIFIC_BACKEND',
        coordinates: [9.22, 49.14],
        fieldCount: 1,
        inputsModified: true,
        isUserCreatedDraft: true,
        farmName: customDraft.name,
        locationLabel: customDraft.site.locationLabel,
        totalAreaHa: 14.5,
        fields: [
          {
            id: 'F1',
            label: 'South Parcel',
            declaredAreaHa: 14.5,
            geometry: customDraft.fields[0]!.geometry,
            candidateCrops: ['wheat', 'barley'],
            irrigationAccess: false,
          },
        ],
      }),
      { params: Promise.resolve({ farmId }) }
    );

    expect(analysisRes.status).toBe(200);
    const analysisJson = (await analysisRes.json()) as {
      ok: boolean;
      job: {
        jobId: string;
        status: string;
        failClosedStatus?: string;
        reportEnvelope?: Record<string, unknown>;
        adaptiveSummary?: Record<string, unknown>;
      };
    };

    expect(analysisJson.ok).toBe(true);
    expect(analysisJson.job.jobId).toMatch(/^job-py-/);
    expect(analysisJson.job.status).toBe('COMPLETED_LIMITED');
    // Audit Section 6.2: never hardcode OK_RECORDED_RESEARCH for non-Uppsala regional screening
    expect(analysisJson.job.failClosedStatus).toBe('OK_COVERAGE_ONLY');
    expect(analysisJson.job.adaptiveSummary?.statusOutcome).toBe('REGIONAL_SCREENING_ONLY');

    const envelopeParsed = ReportEnvelopeSchema.safeParse(analysisJson.job.reportEnvelope);
    expect(envelopeParsed.success).toBe(true);
    if (!envelopeParsed.success) return;
    const envelope = envelopeParsed.data;
    expect(envelope.dataAvailabilityClass).toBe('COVERAGE_ONLY');
    expect(envelope.recommendationNotice).toContain('field_validated = false');
    expect(analysisJson.job.adaptiveSummary?.fieldValidated).toBe(false);
    expect(envelope.sourceCoveragesSummary.some((s) => s.sourceId === 'NASA_POWER_DAILY_AGRO')).toBe(true);
    expect(envelope.sourceCoveragesSummary.some((s) => s.sourceId === 'ISRIC_SOILGRIDS_250M')).toBe(true);

    // Simulate full Next.js server restart by dropping in-memory state and forcing disk re-hydration
    resetPersistedStoreForTests(nextStorePath);

    const restoredFarmRes = await getFarms(
      new NextRequest(`http://localhost:3000/api/farms?farmId=${encodeURIComponent(farmId)}`)
    );
    expect(restoredFarmRes.status).toBe(200);
    const restoredFarmJson = (await restoredFarmRes.json()) as { ok: boolean; farm?: { name: string } };
    expect(restoredFarmJson.farm?.name).toBe('Heilbronn Integrated Test Farm');

    const restoredJobRes = await getAnalysisById(
      new NextRequest(`http://localhost:3000/api/analyses/${encodeURIComponent(analysisJson.job.jobId)}`),
      { params: Promise.resolve({ jobId: analysisJson.job.jobId }) }
    );
    expect(restoredJobRes.status).toBe(200);
    const restoredJobJson = (await restoredJobRes.json()) as { ok: boolean; job?: { failClosedStatus: string } };
    expect(restoredJobJson.job?.failClosedStatus).toBe('OK_COVERAGE_ONLY');

    const restoredReportsRes = await getReports(
      new NextRequest(`http://localhost:3000/api/reports?farmId=${encodeURIComponent(farmId)}`)
    );
    expect(restoredReportsRes.status).toBe(200);
    const restoredReportsJson = (await restoredReportsRes.json()) as {
      ok: boolean;
      reports: Array<{ reportId: string; failClosedStatus?: string }>;
    };
    expect(restoredReportsJson.reports.some((r) => r.reportId === envelope.reportId)).toBe(true);

    const persistedCtx = getPersistedReportContext(envelope.reportId);
    expect(persistedCtx).not.toBeNull();
    expect(persistedCtx?.allowedCitationIds.length).toBeGreaterThan(0);

    // Python store should also have persisted the same reportId
    const pyReportsRes = await fetch(`${pythonUrl}/api/v1/reports?farmId=${encodeURIComponent(farmId)}`);
    expect(pyReportsRes.status).toBe(200);
    const pyReports = (await pyReportsRes.json()) as { ok: boolean; reports: Array<{ reportId: string }> };
    expect(pyReports.reports.some((r) => r.reportId === envelope.reportId)).toBe(true);

    // Security check: unauthenticated spoofed x-astragron-owner-id without HMAC token MUST fail closed (403)
    const chatBody = {
      conversationId: 'conv-e2e-security-1',
      reportId: envelope.reportId,
      farmId,
      inputRevision,
      evidenceVersion: persistedCtx!.evidenceVersion,
      language: 'en',
      question: 'Can you summarize what sources were verified?',
    };

    const spoofedRes = await postReportChat(
      makeJsonPostRequest(`http://localhost:3000/api/reports/${encodeURIComponent(envelope.reportId)}/chat`, chatBody, {
        'x-astragron-owner-id': 'local-farmer-session',
      }),
      { params: Promise.resolve({ reportId: envelope.reportId }) }
    );
    expect(spoofedRes.status).toBe(403);

    const badTokenRes = await postReportChat(
      makeJsonPostRequest(`http://localhost:3000/api/reports/${encodeURIComponent(envelope.reportId)}/chat`, chatBody, {
        'x-astragron-owner-id': 'local-farmer-session',
        'x-astragron-owner-token': '0000deadbeef',
      }),
      { params: Promise.resolve({ reportId: envelope.reportId }) }
    );
    expect(badTokenRes.status).toBe(403);

    // Valid HMAC token reaches the chat gateway -> still fails closed (503 CHAT_NOT_CONNECTED) when no LLM is connected
    const validToken = signOwnerToken(persistedCtx!.ownerId, envelope.reportId);
    const signedRes = await postReportChat(
      makeJsonPostRequest(`http://localhost:3000/api/reports/${encodeURIComponent(envelope.reportId)}/chat`, chatBody, {
        'x-astragron-owner-id': persistedCtx!.ownerId,
        'x-astragron-owner-token': validToken,
      }),
      { params: Promise.resolve({ reportId: envelope.reportId }) }
    );
    expect(signedRes.status).toBe(503);
    const signedJson = (await signedRes.json()) as { status: string };
    expect(signedJson.status).toBe('CHAT_NOT_CONNECTED');
  }, 20000);

  it('preserves unmodified Uppsala M14 abstention while rejecting ocean and mismatched field geometries cleanly', async () => {
    // 1. Unmodified Uppsala M14 benchmark -> ABSTAINED + OK_RECORDED_RESEARCH
    const uppsalaRes = await postFarmAnalysis(
      makeJsonPostRequest('http://localhost:3000/api/farms/uppsala-demo/analyses', {
        farmId: 'uppsala-demo',
        inputRevision: 'uppsala-m14-v1',
        datasetMode: 'RECORDED_M14_RESEARCH',
        coordinates: [17.6389, 59.8586],
        fieldCount: 3,
        inputsModified: false,
        isUserCreatedDraft: false,
      }),
      { params: Promise.resolve({ farmId: 'uppsala-demo' }) }
    );
    expect(uppsalaRes.status).toBe(200);
    const uppsalaJson = (await uppsalaRes.json()) as {
      ok: boolean;
      job: {
        status: string;
        failClosedStatus: string;
        adaptiveSummary?: { fieldValidated?: boolean };
        reportEnvelope?: { dataAvailabilityClass: string };
      };
    };
    expect(uppsalaJson.job.status).toBe('ABSTAINED');
    expect(uppsalaJson.job.failClosedStatus).toBe('OK_RECORDED_RESEARCH');
    expect(uppsalaJson.job.reportEnvelope?.dataAvailabilityClass).toBe('VERIFIED_RECORDED_CORPUS');
    expect(uppsalaJson.job.adaptiveSummary?.fieldValidated).toBe(false);

    // 2. Ocean coordinate -> UNAVAILABLE + MODEL_UNQUALIFIED
    const oceanRes = await postFarmAnalysis(
      makeJsonPostRequest('http://localhost:3000/api/farms/farm-ocean-e2e/analyses', {
        farmId: 'farm-ocean-e2e',
        inputRevision: 'rev-ocean-1',
        datasetMode: 'REAL_SCIENTIFIC_BACKEND',
        coordinates: [-30.0, 45.0],
        fieldCount: 1,
        isUserCreatedDraft: true,
      }),
      { params: Promise.resolve({ farmId: 'farm-ocean-e2e' }) }
    );
    expect(oceanRes.status).toBe(200);
    const oceanJson = (await oceanRes.json()) as {
      ok: boolean;
      job: { status: string; failClosedStatus: string };
    };
    expect(oceanJson.job.status).toBe('UNAVAILABLE');
    expect(oceanJson.job.failClosedStatus).toBe('MODEL_UNQUALIFIED');

    // 3. Heilbronn point paired with Berlin polygon -> HTTP 502 + FAILED + SOURCE_NOT_PROVIDED
    const mismatchRes = await postFarmAnalysis(
      makeJsonPostRequest('http://localhost:3000/api/farms/farm-mismatch-e2e/analyses', {
        farmId: 'farm-mismatch-e2e',
        inputRevision: 'rev-mismatch-1',
        datasetMode: 'REAL_SCIENTIFIC_BACKEND',
        coordinates: [9.22, 49.14],
        fieldCount: 1,
        isUserCreatedDraft: true,
        fields: [
          {
            id: 'F1',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [13.34, 52.51],
                  [13.36, 52.51],
                  [13.36, 52.53],
                  [13.34, 52.53],
                  [13.34, 52.51],
                ],
              ],
            },
          },
        ],
      }),
      { params: Promise.resolve({ farmId: 'farm-mismatch-e2e' }) }
    );
    expect(mismatchRes.status).toBe(502);
    const mismatchJson = (await mismatchRes.json()) as {
      ok: boolean;
      job: { status: string; failClosedStatus: string };
    };
    expect(mismatchJson.ok).toBe(false);
    expect(mismatchJson.job.status).toBe('FAILED');
    expect(mismatchJson.job.failClosedStatus).toBe('SOURCE_NOT_PROVIDED');
  }, 20000);
});
