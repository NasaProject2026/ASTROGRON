import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ClimateWaterDataset, EvidenceRecord, M14DecisionDataset } from '@/domain/contracts';
import {
  translateNativeM14ToDto,
  type NativeM14CorpusInputs,
} from '@/adapters/m14-recorded-translator';
import {
  translateNativeM4Manifest,
  type M4TranslatedCatalog,
} from '@/adapters/m4-coverage-adapter';
import { NativeM14OutputReceiptSchema } from '@/domain/native-schemas';

export interface CorpusIntegrityVerificationResult {
  verified: boolean;
  statusCode: 'OK_VERIFIED_RECORDED' | 'SOURCE_NOT_PROVIDED';
  reason: string;
  m14ProtocolSha256: string | null;
  verifiedFileHashes: Record<string, string>;
  decisionDataset: M14DecisionDataset | null;
  climateDataset: ClimateWaterDataset | null;
  m14EvidenceRecords: EvidenceRecord[];
  m4Catalog: M4TranslatedCatalog | null;
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readVerifiedJson(
  dir: string,
  relPath: string,
  expectedSha256: string,
  hashesOut: Record<string, string>
): unknown {
  const fullPath = path.join(dir, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing canonical source artifact: ${relPath}`);
  }
  const bytes = fs.readFileSync(fullPath);
  const actual = sha256Buffer(bytes);
  if (actual !== expectedSha256) {
    throw new Error(
      `SHA-256 verification failed for ${relPath}: expected ${expectedSha256}, observed ${actual}.`
    );
  }
  hashesOut[relPath] = actual;
  return JSON.parse(bytes.toString('utf8'));
}

function readJsonWithRecord(
  dir: string,
  relPath: string,
  hashesOut: Record<string, string>
): unknown {
  const fullPath = path.join(dir, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing canonical metadata artifact: ${relPath}`);
  }
  const bytes = fs.readFileSync(fullPath);
  hashesOut[relPath] = sha256Buffer(bytes);
  return JSON.parse(bytes.toString('utf8'));
}

/**
 * Server/Node-only SHA-256 integrity verifier & loader for staged M14 & M4 read-only corpora.
 * Never swallows missing files or hash mismatches: fails closed with `SOURCE_NOT_PROVIDED`.
 */
export function loadAndVerifyStagedCorpora(options?: {
  m14Dir?: string;
  m4Dir?: string;
  corpusAvailable?: boolean;
}): CorpusIntegrityVerificationResult {
  if (options?.corpusAvailable === false) {
    return {
      verified: false,
      statusCode: 'SOURCE_NOT_PROVIDED',
      reason: 'Recorded M14 research corpus verification disabled by explicit configuration.',
      m14ProtocolSha256: null,
      verifiedFileHashes: {},
      decisionDataset: null,
      climateDataset: null,
      m14EvidenceRecords: [],
      m4Catalog: null,
    };
  }

  const root = process.cwd();
  const m14Dir = options?.m14Dir ?? path.join(root, 'src', 'data', 'm14-recorded');
  const m4Dir = options?.m4Dir ?? path.join(root, 'src', 'data', 'm4-global');
  const verifiedFileHashes: Record<string, string> = {};

  try {
    const receiptPath = path.join(m14Dir, 'OUTPUT_RECEIPT.json');
    if (!fs.existsSync(receiptPath)) {
      throw new Error('Missing M14 OUTPUT_RECEIPT.json.');
    }
    const receiptBytes = fs.readFileSync(receiptPath);
    verifiedFileHashes['m14/OUTPUT_RECEIPT.json'] = sha256Buffer(receiptBytes);
    const receipt = NativeM14OutputReceiptSchema.parse(JSON.parse(receiptBytes.toString('utf8')));

    const powerReceipt = readJsonWithRecord(
      m14Dir,
      'POWER_RECEIPT.json',
      verifiedFileHashes
    ) as NativeM14CorpusInputs['powerReceipt'];

    // Verify every file listed in OUTPUT_RECEIPT.json (using JSON ones directly + hashing CSVs)
    for (const [fileName, expectedSha] of Object.entries(receipt.files)) {
      const fullPath = path.join(m14Dir, fileName);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Missing receipt-pinned M14 file: ${fileName}`);
      }
      const actual = sha256Buffer(fs.readFileSync(fullPath));
      if (actual !== expectedSha) {
        throw new Error(`M14 receipt SHA-256 mismatch on ${fileName}: ${actual} !== ${expectedSha}`);
      }
      verifiedFileHashes[`m14/${fileName}`] = actual;
    }

    const comparisonDomain = readVerifiedJson(
      m14Dir,
      'COMPARISON_DOMAIN.json',
      receipt.protocol_sha256,
      verifiedFileHashes
    );
    const candidateAudit = readVerifiedJson(
      m14Dir,
      'candidate_audit.json',
      receipt.files['candidate_audit.json']!,
      verifiedFileHashes
    );
    const preferenceDecisions = readVerifiedJson(
      m14Dir,
      'preference_decisions.json',
      receipt.files['preference_decisions.json']!,
      verifiedFileHashes
    );
    const preferenceContract = readVerifiedJson(
      m14Dir,
      'preference_contract.json',
      receipt.files['preference_contract.json']!,
      verifiedFileHashes
    ) as NativeM14CorpusInputs['preferenceContract'];
    const resourceFrontiers = readVerifiedJson(
      m14Dir,
      'resource_frontiers.json',
      receipt.files['resource_frontiers.json']!,
      verifiedFileHashes
    );
    const environment = readJsonWithRecord(
      m14Dir,
      'ENVIRONMENT.json',
      verifiedFileHashes
    ) as NativeM14CorpusInputs['environment'];
    const assumptionRegister = readJsonWithRecord(
      m14Dir,
      'ASSUMPTION_REGISTER.json',
      verifiedFileHashes
    ) as NativeM14CorpusInputs['assumptionRegister'];
    const nasaSourceCatalog = readJsonWithRecord(
      m14Dir,
      'NASA_SOURCE_CATALOG.json',
      verifiedFileHashes
    ) as NativeM14CorpusInputs['nasaSourceCatalog'];
    const power2006To2025 = readVerifiedJson(
      m14Dir,
      'POWER_2006_2025.json',
      powerReceipt.sha256,
      verifiedFileHashes
    ) as NativeM14CorpusInputs['power2006To2025'];

    const translatedM14 = translateNativeM14ToDto({
      receipt,
      environment,
      comparisonDomain,
      candidateAudit,
      preferenceDecisions,
      preferenceContract,
      resourceFrontiers,
      assumptionRegister,
      powerReceipt,
      nasaSourceCatalog,
      power2006To2025,
    });

    // Verify M4 artifacts against DELIVERY_MANIFEST.json
    const m4ManifestDoc = readJsonWithRecord(
      m4Dir,
      'DELIVERY_MANIFEST.json',
      verifiedFileHashes
    ) as { files?: Record<string, { sha256: string }> };

    const covSha = m4ManifestDoc.files?.['GLOBAL_COVERAGE_MANIFEST.json']?.sha256;
    if (!covSha) {
      throw new Error('Missing GLOBAL_COVERAGE_MANIFEST.json checksum in M4 DELIVERY_MANIFEST.json.');
    }
    const rawGlobalCoverage = readVerifiedJson(
      m4Dir,
      'GLOBAL_COVERAGE_MANIFEST.json',
      covSha,
      verifiedFileHashes
    );
    const m4Catalog = translateNativeM4Manifest(rawGlobalCoverage);

    return {
      verified: true,
      statusCode: 'OK_VERIFIED_RECORDED',
      reason: `SHA-256 verified M14 protocol ${receipt.protocol_sha256.slice(0, 12)}... and M4 coverage manifest.`,
      m14ProtocolSha256: receipt.protocol_sha256,
      verifiedFileHashes,
      decisionDataset: translatedM14.decisionDataset,
      climateDataset: translatedM14.climateDataset,
      m14EvidenceRecords: translatedM14.evidenceRecords,
      m4Catalog,
    };
  } catch (err) {
    return {
      verified: false,
      statusCode: 'SOURCE_NOT_PROVIDED',
      reason: err instanceof Error ? err.message : String(err),
      m14ProtocolSha256: null,
      verifiedFileHashes,
      decisionDataset: null,
      climateDataset: null,
      m14EvidenceRecords: [],
      m4Catalog: null,
    };
  }
}
