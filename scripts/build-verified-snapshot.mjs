import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);

const root = process.cwd();
const outDir = path.join(root, 'src', 'data', 'generated');
const outFile = path.join(outDir, 'verified-m14-m4-snapshot.json');
fs.mkdirSync(outDir, { recursive: true });

// Compile & evaluate the authoritative TypeScript SHA-256 verifier cleanly in memory/temp
const tmpBundle = path.join(outDir, '.tmp-corpus-loader.cjs');
esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'server', 'corpus-integrity.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: tmpBundle,
  alias: {
    '@': path.join(root, 'src'),
  },
  logLevel: 'silent',
});

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadAndVerifyStagedCorpora } = require(tmpBundle);
  const result = loadAndVerifyStagedCorpora();
  if (!result.verified || !result.decisionDataset || !result.climateDataset || !result.m4Catalog) {
    throw new Error(`Corpus verification failed closed: ${result.reason}`);
  }

  const payloadWithoutDigest = {
    schema: 'astragron.verified-recorded-snapshot.v1',
    verified: true,
    m14ProtocolSha256: result.m14ProtocolSha256,
    verifiedFileHashes: result.verifiedFileHashes,
    decisionDataset: result.decisionDataset,
    climateDataset: result.climateDataset,
    m14EvidenceRecords: result.m14EvidenceRecords,
    m4Catalog: result.m4Catalog,
  };

  const canonicalJson = JSON.stringify(payloadWithoutDigest);
  const snapshotSha256 = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');

  const finalSnapshot = {
    ...payloadWithoutDigest,
    snapshotSha256,
  };

  fs.writeFileSync(outFile, JSON.stringify(finalSnapshot), 'utf8');
  const bytes = fs.statSync(outFile).size;
  console.log(
    `Generated ${path.relative(root, outFile)} (${bytes} bytes, snapshotSha256=${snapshotSha256}, policies=${result.decisionDataset.policies.length}, cases=${result.decisionDataset.portfolioSummary.totalPolicyStateCases})`
  );
} finally {
  if (fs.existsSync(tmpBundle)) fs.unlinkSync(tmpBundle);
}
