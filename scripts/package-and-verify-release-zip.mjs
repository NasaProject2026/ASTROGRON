#!/usr/bin/env node
/**
 * Regenerates the authoritative SHA-256 manifest, creates ASTRAGRON_UNIFIED_E2E_SCIENTIFIC_INTEGRATION.zip,
 * extracts it to a fresh temporary directory, and runs verify-manifest.mjs + verify-protected-files.mjs
 * + Python adaptive_evidence import check inside the extracted folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 1. Regenerate release manifests so every file (including this script) has an exact SHA-256 entry
execFileSync(process.execPath, [path.join(ROOT, 'scripts/generate-release-manifest.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});

// 2. Verify manifest in workspace
execFileSync(process.execPath, [path.join(ROOT, 'scripts/verify-manifest.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});

// 3. Stage clean release files into a temporary staging folder to build the ZIP cleanly
const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astragron-v7-stage-'));
const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astragron-v7-extract-'));

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'review/12_HASHES_AND_DELIVERY_MANIFEST.json'), 'utf8')
);
const relFilesToCopy = [
  ...manifest.files.map((f) => f.path),
  'review/12_HASHES_AND_DELIVERY_MANIFEST.json',
  'review/SMART_FIELDS_SHA256_MANIFEST.json',
  'review/V7_RELEASE_SHA256_MANIFEST.json',
];

for (const rel of relFilesToCopy) {
  const src = path.join(ROOT, rel);
  const dst = path.join(stageRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const outZipArtifact =
  'C:\\Users\\HP\\.gemini\\antigravity\\brain\\3ac899d3-46e0-4094-ad7f-0b55172ca787\\ASTRAGRON_UNIFIED_E2E_SCIENTIFIC_INTEGRATION.zip';
const outZipParent = path.resolve(ROOT, '..', 'ASTRAGRON_UNIFIED_E2E_SCIENTIFIC_INTEGRATION.zip');

for (const z of [outZipArtifact, outZipParent]) {
  if (fs.existsSync(z)) fs.unlinkSync(z);
}

// Create ZIP using PowerShell Compress-Archive from staged directory
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path "${stageRoot}\\*" -DestinationPath "${outZipArtifact}" -Force`,
  ],
  { stdio: 'inherit' }
);
fs.copyFileSync(outZipArtifact, outZipParent);

const zipStat = fs.statSync(outZipArtifact);
const sizeMb = (zipStat.size / (1024 * 1024)).toFixed(2);
console.log(
  `[package-and-verify] Created ASTRAGRON_UNIFIED_E2E_SCIENTIFIC_INTEGRATION.zip (${sizeMb} MB, ${zipStat.size} bytes)`
);
if (zipStat.size >= 20 * 1024 * 1024) {
  throw new Error(`ZIP size ${sizeMb} MB exceeds 20 MB limit!`);
}

// 4. Extract ZIP into fresh temp folder and run verify-manifest.mjs + verify-protected-files.mjs without regenerating hashes
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path "${outZipArtifact}" -DestinationPath "${extractRoot}" -Force`,
  ],
  { stdio: 'inherit' }
);

console.log('[package-and-verify] Running verify-manifest.mjs inside freshly extracted ZIP...');
execFileSync(process.execPath, [path.join(extractRoot, 'scripts/verify-manifest.mjs')], {
  cwd: extractRoot,
  stdio: 'inherit',
});

console.log('[package-and-verify] Running verify-protected-files.mjs inside freshly extracted ZIP...');
execFileSync(process.execPath, [path.join(extractRoot, 'scripts/verify-protected-files.mjs')], {
  cwd: extractRoot,
  stdio: 'inherit',
});

const pythonCandidates = [
  process.env.ASTRAGRON_PYTHON_BIN,
  path.resolve(ROOT, '..', '.venv', 'Scripts', 'python.exe'),
  path.resolve(ROOT, '.venv', 'Scripts', 'python.exe'),
  'python',
].filter(Boolean);
const pythonBin = pythonCandidates.find((p) => p === 'python' || fs.existsSync(p));
if (!pythonBin) {
  throw new Error('No Python executable found for extracted archive sanity check.');
}
console.log(`[package-and-verify] Running Python import adaptive_evidence sanity check (${pythonBin})...`);
execFileSync(
  pythonBin,
  ['-B', '-X', 'utf8', '-c', 'import adaptive_evidence, adaptive_evidence.unified_server; print("IMPORT_ADAPTIVE_EVIDENCE_OK")'],
  { cwd: extractRoot, stdio: 'inherit' }
);

fs.rmSync(stageRoot, { recursive: true, force: true });
fs.rmSync(extractRoot, { recursive: true, force: true });
console.log('[package-and-verify] Fresh ZIP extraction verification PASSED.');
