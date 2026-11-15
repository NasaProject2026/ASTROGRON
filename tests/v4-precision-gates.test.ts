import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  computeDraftInputRevision,
  detectDraftModificationReasons,
  parseDmsCoordinateString,
  isSafeExternalUrl,
} from '@/domain/schemas';
import {
  DEFAULT_UPPSALA_FARM_DRAFT,
  UPPSALA_REFERENCE_INPUT_REVISION,
} from '@/fixtures/sites-and-coverage';
import {
  getRepositoryForMode,
  buildSiteBoundExportPayload,
} from '@/adapters/repositories';
import { enMessages } from '@/messages/en';
import {
  validateManifestRelativePath,
  verifyManifestDirectory,
} from '../scripts/verify-manifest.mjs';
import type { RepositoryStatusCode, UserFarmDraft } from '@/domain/contracts';

function cloneUppsalaDraft(): UserFarmDraft {
  return JSON.parse(JSON.stringify(DEFAULT_UPPSALA_FARM_DRAFT)) as UserFarmDraft;
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'data' && path.basename(dir) === 'src') {
        continue;
      }
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('ASTRAGRON V4 Precision Acceptance Gates (S01-S08, E01-E06, G01-G08, Q05-Q06, P01)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('S01-S04: pins immutable Uppsala revision and blocks modified/custom Uppsala drafts across results, climate, evidence & exports', () => {
    const refRev = computeDraftInputRevision(DEFAULT_UPPSALA_FARM_DRAFT);
    expect(refRev).toBe(UPPSALA_REFERENCE_INPUT_REVISION);

    const repo = getRepositoryForMode('SYNTHETIC_UI_DEMO', ['custom-uppsala-deadbeef']);

    // Untouched Uppsala draft succeeds strictly in SYNTHETIC_UI_DEMO
    const untouchedDecision = repo.getM14DecisionEvaluation('uppsala-demo', DEFAULT_UPPSALA_FARM_DRAFT);
    expect(untouchedDecision.status).toBe('OK_SYNTHETIC_DEMO');
    expect(untouchedDecision.data).not.toBeNull();
    expect(untouchedDecision.inputIdentity?.inputsModified).toBe(false);

    // Modified declaredAreaHa MUST fail closed with ANALYSIS_NOT_RUN_FOR_INPUT_REVISION
    const editedAreaDraft = cloneUppsalaDraft();
    editedAreaDraft.id = 'custom-uppsala-area-edit';
    editedAreaDraft.derivedFromFixtureId = 'uppsala-demo';
    editedAreaDraft.isUserCreatedDraft = true;
    editedAreaDraft.inputsModified = true;
    editedAreaDraft.fields[0]!.declaredAreaHa = 99.5;

    const reasons = detectDraftModificationReasons(editedAreaDraft, DEFAULT_UPPSALA_FARM_DRAFT);
    expect(reasons.length).toBeGreaterThan(0);
    expect(computeDraftInputRevision(editedAreaDraft)).not.toBe(UPPSALA_REFERENCE_INPUT_REVISION);

    const blockedDecision = repo.getM14DecisionEvaluation(editedAreaDraft.id, editedAreaDraft);
    expect(blockedDecision.status).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');
    expect(blockedDecision.data).toBeNull();
    expect(blockedDecision.inputIdentity?.inputsModified).toBe(true);

    const blockedClimate = repo.getClimateWaterSeries(editedAreaDraft.id, editedAreaDraft);
    expect(blockedClimate.status).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');
    expect(blockedClimate.data).toBeNull();

    const blockedEvidence = repo.getEvidenceRecords(editedAreaDraft.id, editedAreaDraft);
    expect(blockedEvidence.status).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');
    expect(blockedEvidence.data).toEqual([]);

    const exportPayload = buildSiteBoundExportPayload(
      editedAreaDraft.id,
      editedAreaDraft.name,
      [editedAreaDraft.site.longitude, editedAreaDraft.site.latitude],
      'MINIMIZE_WORST_ET_SHORTFALL',
      repo,
      editedAreaDraft
    );
    expect(exportPayload.exportStatus).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');
    expect(exportPayload.decisionDataset).toBeNull();
    expect(exportPayload.climateDataset).toBeNull();
    expect(exportPayload.evidenceRecords).toEqual([]);
    expect(exportPayload.inputIdentity?.inputsModified).toBe(true);
    expect(JSON.stringify(exportPayload)).not.toContain('SYNTH-POL-01');
    expect(JSON.stringify(exportPayload)).not.toContain('38420.5');
  });

  it('S05-S08: keeps zero M14 corpus hashes in frontend runtime and isolates modes + non-Uppsala domains', () => {
    const srcFiles = [
      ...collectSourceFiles(path.resolve(process.cwd(), 'src')),
      ...collectSourceFiles(path.resolve(process.cwd(), 'app')),
    ];
    for (const f of srcFiles) {
      const content = fs.readFileSync(f, 'utf8');
      expect(content, `Unexpected M14 corpus hash found in ${f}`).not.toContain('a27063ce2eca13f02e03');
      expect(content, `Unexpected M14 corpus hash found in ${f}`).not.toContain('fa0e548ed3a7ccbcad4e');
    }

    const m14RepoUnavailable = getRepositoryForMode('RECORDED_M14_RESEARCH', [], { corpusAvailable: false });
    expect(m14RepoUnavailable.getM14DecisionEvaluation('uppsala-demo').status).toBe('SOURCE_NOT_PROVIDED');
    expect(m14RepoUnavailable.getClimateWaterSeries('uppsala-demo').status).toBe('SOURCE_NOT_PROVIDED');

    const m14Repo = getRepositoryForMode('RECORDED_M14_RESEARCH');
    expect(m14Repo.getM14DecisionEvaluation('uppsala-demo').status).toBe('OK_RECORDED_RESEARCH');
    expect(m14Repo.getClimateWaterSeries('uppsala-demo').status).toBe('OK_RECORDED_RESEARCH');

    const backendRepo = getRepositoryForMode('REAL_SCIENTIFIC_BACKEND');
    expect(backendRepo.getM14DecisionEvaluation('uppsala-demo').status).toBe('BACKEND_NOT_CONNECTED');
    expect(backendRepo.getEvidenceRecords('uppsala-demo').status).toBe('BACKEND_NOT_CONNECTED');

    const synthRepo = getRepositoryForMode('SYNTHETIC_UI_DEMO');
    for (const nonUppsala of ['nyeri-kenya', 'wagga-australia', 'polar-svalbard', 'ocean-atlantic', 'antimeridian-taveuni']) {
      const d = synthRepo.getM14DecisionEvaluation(nonUppsala);
      expect(d.status).toBe('MODEL_UNQUALIFIED');
      expect(d.data).toBeNull();
    }
  });

  it('E01-E06: enforces site-scoped and mode-scoped getEvidenceRecord without Uppsala fallback', () => {
    const repo = getRepositoryForMode('SYNTHETIC_UI_DEMO');

    const uppsalaOk = repo.getEvidenceRecord(
      { siteId: 'uppsala-demo', datasetMode: 'SYNTHETIC_UI_DEMO' },
      'syn-ev-uppsala-weather-2018',
      DEFAULT_UPPSALA_FARM_DRAFT
    );
    expect(uppsalaOk.status).toBe('OK_SYNTHETIC_DEMO');
    expect(uppsalaOk.data?.evidence_id).toBe('syn-ev-uppsala-weather-2018');

    // Cross-site lookup MUST fail closed with NO_EVIDENCE_FOR_SITE and data: null
    const crossSiteBlocked = repo.getEvidenceRecord(
      { siteId: 'nyeri-kenya', datasetMode: 'SYNTHETIC_UI_DEMO' },
      'syn-ev-uppsala-weather-2018'
    );
    expect(crossSiteBlocked.status).toBe('NO_EVIDENCE_FOR_SITE');
    expect(crossSiteBlocked.data).toBeNull();

    // Ocean / polar / antimeridian have zero bundled M4 records unless present
    const oceanEv = repo.getEvidenceRecord(
      { siteId: 'ocean-atlantic', datasetMode: 'SYNTHETIC_UI_DEMO' },
      'syn-ev-uppsala-water-assumption'
    );
    expect(oceanEv.status).toBe('NO_EVIDENCE_FOR_SITE');
    expect(oceanEv.data).toBeNull();

    // Mismatched operating mode MUST fail closed
    const modeMismatch = repo.getEvidenceRecord(
      { siteId: 'uppsala-demo', datasetMode: 'REAL_SCIENTIFIC_BACKEND' },
      'syn-ev-uppsala-weather-2018'
    );
    expect(modeMismatch.status).toBe('BACKEND_NOT_CONNECTED');
    expect(modeMismatch.data).toBeNull();
  });

  it('G01-G08: strictly parses signed negative/zero DMS coordinates and rejects sign/axis/range errors', () => {
    const negLon = parseDmsCoordinateString('-17° 30\' 00"', 'LON');
    expect(negLon.valid).toBe(true);
    expect(negLon.decimal).toBe(-17.5);

    const negLat = parseDmsCoordinateString('-12° 20\' 00"', 'LAT');
    expect(negLat.valid).toBe(true);
    expect(negLat.decimal).toBeCloseTo(-12.333333, 6);

    const negZero = parseDmsCoordinateString('-0° 30\' 00"', 'LAT');
    expect(negZero.valid).toBe(true);
    expect(negZero.decimal).toBe(-0.5);

    const eastLon = parseDmsCoordinateString('17° 38\' 24" E', 'LON');
    expect(eastLon.valid).toBe(true);
    expect(eastLon.decimal).toBe(17.64);

    // Sign vs hemisphere conflicts MUST fail
    expect(parseDmsCoordinateString('-17° E', 'LON').valid).toBe(false);
    expect(parseDmsCoordinateString('+17° W', 'LON').valid).toBe(false);

    // Axis & range overflows MUST fail
    expect(parseDmsCoordinateString('180° 0\' 1"', 'LON').valid).toBe(false);
    expect(parseDmsCoordinateString('90° 0\' 1"', 'LAT').valid).toBe(false);
    expect(parseDmsCoordinateString('17° 60\' 00"', 'LON').valid).toBe(false);
    expect(parseDmsCoordinateString('17° 30\' 60"', 'LON').valid).toBe(false);
    expect(parseDmsCoordinateString('17° N', 'LON').valid).toBe(false);
  });

  it('Q05-Q06: validates safe external URLs and covers all 8 status codes in centralized i18n dictionary', () => {
    expect(isSafeExternalUrl('https://cloudless.eox.at/documentation/license')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeExternalUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeExternalUrl('//evil.example.org/payload')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);

    const expectedStatuses: RepositoryStatusCode[] = [
      'OK_SYNTHETIC_DEMO',
      'OK_COVERAGE_ONLY',
      'MODEL_UNQUALIFIED',
      'BACKEND_NOT_CONNECTED',
      'SOURCE_NOT_PROVIDED',
      'SITE_NOT_FOUND',
      'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION',
      'NO_EVIDENCE_FOR_SITE',
    ];
    for (const s of expectedStatuses) {
      expect(enMessages.statusCards[s].title.length).toBeGreaterThan(5);
      expect(enMessages.statusCards[s].simpleTitle.length).toBeGreaterThan(5);
    }
  });

  it('P01: verify-manifest rejects path traversal, drive/absolute paths, symlinks, and normalizes separators', () => {
    expect(validateManifestRelativePath('src/app/page.tsx').valid).toBe(true);
    expect(validateManifestRelativePath('review\\00_REPORT.md').posixPath).toBe('review/00_REPORT.md');
    expect(validateManifestRelativePath('../outside.txt').valid).toBe(false);
    expect(validateManifestRelativePath('a/../b.txt').valid).toBe(false);
    expect(validateManifestRelativePath('/etc/passwd').valid).toBe(false);
    expect(validateManifestRelativePath('C:\\Windows\\System32\\cmd.exe').valid).toBe(false);
    expect(validateManifestRelativePath('C:relative.txt').valid).toBe(false);

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astragron-manifest-test-'));
    try {
      const samplePath = path.join(tmpRoot, 'hello.txt');
      const content = Buffer.from('astragron-verified-bytes');
      fs.writeFileSync(samplePath, content);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');

      const manifestFile = path.join(tmpRoot, 'manifest.json');
      fs.writeFileSync(
        manifestFile,
        JSON.stringify({
          total_files: 1,
          files: [{ path: 'hello.txt', size_bytes: content.length, sha256 }],
        })
      );

      expect(verifyManifestDirectory(tmpRoot, 'manifest.json').ok).toBe(true);

      // Symlink check without requiring Admin on Windows
      const lstatSpy = vi.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => true,
        isFile: () => false,
        isDirectory: () => false,
      } as unknown as fs.Stats);
      try {
        const symlinkResult = verifyManifestDirectory(tmpRoot, 'manifest.json');
        expect(symlinkResult.ok).toBe(false);
        expect(symlinkResult.errors[0]).toContain('SYMLINK_OR_NON_FILE');
      } finally {
        lstatSpy.mockRestore();
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
