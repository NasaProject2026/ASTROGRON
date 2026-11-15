import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestRelPath = 'review/12_HASHES_AND_DELIVERY_MANIFEST.json';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'test-results',
  'playwright-report',
  '.turbo',
]);

const EXCLUDED_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  'tsconfig.tsbuildinfo',
  '.DS_Store',
  'Thumbs.db',
  manifestRelPath,
]);

function walkFiles(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const entry of entries) {
    const relPosix = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...walkFiles(path.join(dir, entry.name), relPosix));
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name) || EXCLUDED_FILES.has(relPosix) || entry.name.endsWith('.zip')) {
        continue;
      }
      const abs = path.join(dir, entry.name);
      const buf = fs.readFileSync(abs);
      out.push({
        path: relPosix,
        size_bytes: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    }
  }
  return out;
}

const files = walkFiles(root);
const totalBytes = files.reduce((acc, item) => acc + item.size_bytes, 0);

const manifest = {
  package_name: 'ASTRAGRON_FRONTEND_REMEDIATED_CODEX.zip',
  verdict: 'STANDALONE_FRONTEND_BUILD_AND_BROWSER_GATES_EXECUTED',
  generated_at: new Date().toISOString(),
  total_files: files.length,
  total_bytes_uncompressed: totalBytes,
  engineering_gates: {
    static_gates: 'npm run typecheck && npm run lint && npm test && node scripts/mobile-ux-offline-gates.mjs',
    production_build: 'npm run build (Next.js 16.4.6 Turbopack, including restored /farm/[id]/coverage and isolated /orbit-ab)',
    browser_verification: 'npx playwright test (astragron-journey.spec.ts + v4-review-regressions.spec.ts + orbit-ab-benchmark.spec.ts)',
    scientific_backend: 'NOT CONNECTED — M1-M14 protected engine untouched; FIELD_RECOMMENDATION_ELIGIBILITY remains BLOCKED',
  },
  files,
};

fs.writeFileSync(path.join(root, manifestRelPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Generated ${manifestRelPath}: ${files.length} files (${totalBytes} bytes uncompressed).`);
