#!/usr/bin/env node
/**
 * Generates the authoritative SHA-256 release manifests for ASTRAGRON V7 Release Closure:
 * - review/12_HASHES_AND_DELIVERY_MANIFEST.json (default checked by scripts/verify-manifest.mjs)
 * - review/SMART_FIELDS_SHA256_MANIFEST.json
 * - review/V7_RELEASE_SHA256_MANIFEST.json
 *
 * Excludes build caches (.next, node_modules, .git, test-results, playwright-report),
 * transient tsconfig.tsbuildinfo, the legacy pre-mission heavy media listed in
 * review/OMITTED_HEAVY_MEDIA_INVENTORY.json (to stay < 20 MB while keeping all V7/Smart-Fields
 * live screenshots, recordings, and 100% of source/data/tests), and the manifest output files themselves.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'test-results',
  'playwright-report',
  '.swc',
  '.turbo',
  '.venv',
  '__pycache__',
  '.pytest_cache',
]);

const MANIFEST_OUTPUT_REL_PATHS = new Set([
  'review/12_HASHES_AND_DELIVERY_MANIFEST.json',
  'review/SMART_FIELDS_SHA256_MANIFEST.json',
  'review/V7_RELEASE_SHA256_MANIFEST.json',
]);

const OMITTED_INVENTORY_REL = 'review/OMITTED_HEAVY_MEDIA_INVENTORY.json';
const omittedInventoryFull = path.join(ROOT, OMITTED_INVENTORY_REL);
const omittedRelPaths = new Set(['tsconfig.tsbuildinfo']);

if (fs.existsSync(omittedInventoryFull)) {
  const inv = JSON.parse(fs.readFileSync(omittedInventoryFull, 'utf8'));
  if (Array.isArray(inv.omittedMediaFiles)) {
    const existingSet = new Set(inv.omittedMediaFiles.map((x) => x.path));
    const smartBeforeDir = path.join(ROOT, 'review/screenshots/smart_before');
    if (fs.existsSync(smartBeforeDir)) {
      for (const name of fs.readdirSync(smartBeforeDir).sort()) {
        const rel = `review/screenshots/smart_before/${name}`;
        if (!existingSet.has(rel)) {
          inv.omittedMediaFiles.push({
            path: rel,
            bytes: 0,
            sha256: '',
            reason: 'duplicate_pre_mission_baseline_screenshots_omitted_for_20mb_budget',
          });
          existingSet.add(rel);
        }
      }
    }
    let totalBytes = 0;
    for (const item of inv.omittedMediaFiles) {
      if (item.path) {
        omittedRelPaths.add(item.path);
        const full = path.join(ROOT, item.path);
        if (fs.existsSync(full)) {
          const buf = fs.readFileSync(full);
          item.bytes = buf.length;
          item.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
          totalBytes += buf.length;
        }
      }
    }
    inv.omittedMediaFileCount = inv.omittedMediaFiles.length;
    inv.omittedMediaTotalBytes = totalBytes;
    fs.writeFileSync(omittedInventoryFull, JSON.stringify(inv, null, 2) + '\n', 'utf8');
  }
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function collectFiles(dir, relPrefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (relPath === 'data/runtime') continue;
      results.push(...collectFiles(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      if (entry.name === '.git' || entry.name === '.DS_Store') continue;
      if (MANIFEST_OUTPUT_REL_PATHS.has(relPath)) continue;
      if (omittedRelPaths.has(relPath)) continue;
      if (entry.name.endsWith('.zip') || entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) continue;
      results.push(relPath);
    }
  }
  return results;
}

const allRelPaths = collectFiles(ROOT).sort();
const files = allRelPaths.map((relPath) => {
  const fullPath = path.join(ROOT, relPath);
  const stat = fs.statSync(fullPath);
  return {
    path: relPath,
    size_bytes: stat.size,
    sizeBytes: stat.size,
    sha256: sha256File(fullPath),
  };
});

const payload = {
  package: 'ASTRAGRON_UNIFIED_E2E_SCIENTIFIC_INTEGRATION',
  version: '8.0.0-unified-e2e-integration',
  generated_at: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  algorithm: 'SHA-256',
  total_files: files.length,
  totalFiles: files.length,
  files,
};

const jsonStr = JSON.stringify(payload, null, 2) + '\n';
for (const outRel of MANIFEST_OUTPUT_REL_PATHS) {
  const outFull = path.join(ROOT, outRel);
  fs.mkdirSync(path.dirname(outFull), { recursive: true });
  fs.writeFileSync(outFull, jsonStr, 'utf8');
}

console.log(
  `[generate-release-manifest] Wrote ${files.length} file hashes to ${Array.from(MANIFEST_OUTPUT_REL_PATHS).join(', ')}`
);
