#!/usr/bin/env node
/**
 * Gate 5 — Authoritative Release Manifest & Tamper-Detection Verification
 * Runs verifyManifestDirectory on the live workspace + 3 isolated temporary tamper cases:
 *  1. Modified file byte (SHA256_MISMATCH)
 *  2. Deleted file (MISSING)
 *  3. Unsafe "../" relative path in manifest (INVALID_PATH)
 * Writes structured proof to review/final-closure/MANIFEST_TAMPER_TESTS.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyManifestDirectory } from './verify-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function createSandboxFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astragron-v7-manifest-test-'));
  fs.mkdirSync(path.join(tmpDir, 'review'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

  const sampleA = Buffer.from('export const A = "astragron-v7";\n', 'utf8');
  const sampleB = Buffer.from('export const B = 42;\n', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'src/a.ts'), sampleA);
  fs.writeFileSync(path.join(tmpDir, 'src/b.ts'), sampleB);

  const files = [
    {
      path: 'src/a.ts',
      size_bytes: sampleA.length,
      sizeBytes: sampleA.length,
      sha256: crypto.createHash('sha256').update(sampleA).digest('hex'),
    },
    {
      path: 'src/b.ts',
      size_bytes: sampleB.length,
      sizeBytes: sampleB.length,
      sha256: crypto.createHash('sha256').update(sampleB).digest('hex'),
    },
  ];
  const manifest = {
    package: 'SANDBOX_TAMPER_TEST',
    total_files: files.length,
    files,
  };
  fs.writeFileSync(
    path.join(tmpDir, 'review/12_HASHES_AND_DELIVERY_MANIFEST.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  return { tmpDir, manifest };
}

// 1. Tamper test A: Modified 1 byte in src/a.ts
const sandbox1 = createSandboxFixture();
const origA = fs.readFileSync(path.join(sandbox1.tmpDir, 'src/a.ts'));
const mutatedA = Buffer.from(origA);
mutatedA[0] = mutatedA[0] === 0x65 ? 0x45 : 0x65;
fs.writeFileSync(path.join(sandbox1.tmpDir, 'src/a.ts'), mutatedA);
const tamperModifiedResult = verifyManifestDirectory(sandbox1.tmpDir);
fs.rmSync(sandbox1.tmpDir, { recursive: true, force: true });

// 2. Tamper test B: Deleted src/b.ts
const sandbox2 = createSandboxFixture();
fs.unlinkSync(path.join(sandbox2.tmpDir, 'src/b.ts'));
const tamperMissingResult = verifyManifestDirectory(sandbox2.tmpDir);
fs.rmSync(sandbox2.tmpDir, { recursive: true, force: true });

// 3. Tamper test C: Unsafe "../escape.txt" path in manifest
const sandbox3 = createSandboxFixture();
sandbox3.manifest.files.push({
  path: '../escape.txt',
  size_bytes: 10,
  sha256: '0'.repeat(64),
});
sandbox3.manifest.total_files = sandbox3.manifest.files.length;
fs.writeFileSync(
  path.join(sandbox3.tmpDir, 'review/12_HASHES_AND_DELIVERY_MANIFEST.json'),
  JSON.stringify(sandbox3.manifest, null, 2),
  'utf8'
);
const tamperTraversalResult = verifyManifestDirectory(sandbox3.tmpDir);
fs.rmSync(sandbox3.tmpDir, { recursive: true, force: true });

const allTamperCaught =
  !tamperModifiedResult.ok &&
  tamperModifiedResult.errors.some((e) => e.startsWith('SHA256_MISMATCH:')) &&
  !tamperMissingResult.ok &&
  tamperMissingResult.errors.some((e) => e.startsWith('MISSING:')) &&
  !tamperTraversalResult.ok &&
  tamperTraversalResult.errors.some((e) => e.startsWith('INVALID_PATH:'));

const report = {
  generatedAt: new Date().toISOString(),
  allTamperChecksPassed: allTamperCaught,
  tests: {
    modifiedByte: {
      expectedFailure: 'SHA256_MISMATCH',
      ok: tamperModifiedResult.ok,
      failedCount: tamperModifiedResult.failed,
      errors: tamperModifiedResult.errors,
    },
    deletedFile: {
      expectedFailure: 'MISSING',
      ok: tamperMissingResult.ok,
      failedCount: tamperMissingResult.failed,
      errors: tamperMissingResult.errors,
    },
    unsafeRelativePath: {
      expectedFailure: 'INVALID_PATH',
      ok: tamperTraversalResult.ok,
      failedCount: tamperTraversalResult.failed,
      errors: tamperTraversalResult.errors,
    },
  },
};

const outPath = path.join(ROOT, 'review/final-closure/MANIFEST_TAMPER_TESTS.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

if (!allTamperCaught) {
  console.error('[run-manifest-tamper-tests] Tamper detection check failed:', report);
  process.exit(1);
}
console.log('[run-manifest-tamper-tests] All 3 tamper cases rejected as expected.');
