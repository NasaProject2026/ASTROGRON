import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function validateManifestRelativePath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return { valid: false, reason: 'Empty or non-string path' };
  }
  const posix = rawPath.replace(/\\/g, '/').trim();
  if (posix.startsWith('/') || posix.startsWith('//') || /^[A-Za-z]:/.test(posix)) {
    return { valid: false, reason: `Absolute or drive-qualified path rejected: ${rawPath}` };
  }
  const segments = posix.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.' || seg.length === 0)) {
    return { valid: false, reason: `Path traversal or empty segment rejected: ${rawPath}` };
  }
  return { valid: true, posixPath: posix };
}

/**
 * Verify a portable archive against immutable SHA-256 digests.
 * Manifest paths, parent directories, and file targets must all be confined
 * inside rootDir. Every symlink along a path is rejected, not only leaf links.
 */
export function verifyManifestDirectory(
  rootDir,
  manifestRelativePath = 'review/12_HASHES_AND_DELIVERY_MANIFEST.json'
) {
  const resolvedRoot = path.resolve(rootDir);
  const checkedManifest = validateManifestRelativePath(manifestRelativePath);
  if (!checkedManifest.valid) {
    return { ok: false, passed: 0, failed: 1, total: 0, errors: [`INVALID_MANIFEST_PATH: ${checkedManifest.reason}`] };
  }

  // Check every segment before opening the JSON, including a symlinked parent.
  function resolveSafeFile(relativePath) {
    const validated = validateManifestRelativePath(relativePath);
    if (!validated.valid) {
      return { error: `INVALID_PATH: ${validated.reason}` };
    }
    let cursor = resolvedRoot;
    for (const segment of validated.posixPath.split('/')) {
      cursor = path.join(cursor, segment);
      if (!fs.existsSync(cursor)) {
        return { error: `MISSING: ${validated.posixPath}` };
      }
      let stat;
      try {
        stat = fs.lstatSync(cursor);
      } catch {
        return { error: `UNREADABLE: ${validated.posixPath}` };
      }
      if (stat.isSymbolicLink()) {
        return { error: `SYMLINK_OR_NON_FILE: ${validated.posixPath}` };
      }
    }
    if (!fs.lstatSync(cursor).isFile()) {
      return { error: `SYMLINK_OR_NON_FILE: ${validated.posixPath}` };
    }
    // Also reject platform-specific symlink/realpath behavior; ensure realpath
    // confinement after all component checks.
    let canonical;
    try {
      canonical = fs.realpathSync(cursor);
    } catch {
      return { error: `UNREADABLE: ${validated.posixPath}` };
    }
    const relative = path.relative(fs.realpathSync(resolvedRoot), canonical);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { error: `ESCAPE_PATH: ${validated.posixPath}` };
    }
    return { path: canonical };
  }

  const manifestFile = resolveSafeFile(checkedManifest.posixPath);
  if (manifestFile.error) {
    return { ok: false, passed: 0, failed: 1, total: 0, errors: [manifestFile.error] };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile.path, 'utf8'));
  } catch (err) {
    return { ok: false, passed: 0, failed: 1, total: 0, errors: [`INVALID_MANIFEST_JSON: ${String(err)}`] };
  }
  if (!manifest || !Array.isArray(manifest.files)) {
    return { ok: false, passed: 0, failed: 1, total: 0, errors: ['Manifest does not contain a valid "files" array.'] };
  }

  let passed = 0;
  let failed = 0;
  const errors = [];
  const seen = new Set();

  for (const entry of manifest.files) {
    const checked = validateManifestRelativePath(entry?.path);
    if (!checked.valid) {
      errors.push(`INVALID_PATH: ${checked.reason}`);
      failed++;
      continue;
    }
    const rel = checked.posixPath;
    if (seen.has(rel)) {
      errors.push(`DUPLICATE_PATH: ${rel}`);
      failed++;
      continue;
    }
    seen.add(rel);
    const file = resolveSafeFile(rel);
    if (file.error) {
      errors.push(file.error);
      failed++;
      continue;
    }
    const content = fs.readFileSync(file.path);
    const actualSha = crypto.createHash('sha256').update(content).digest('hex');
    if (content.length !== entry.size_bytes) {
      errors.push(`SIZE_MISMATCH: ${rel} expected=${entry.size_bytes} actual=${content.length}`);
      failed++;
      continue;
    }
    if (actualSha !== entry.sha256) {
      errors.push(`SHA256_MISMATCH: ${rel} expected=${entry.sha256} actual=${actualSha}`);
      failed++;
      continue;
    }
    passed++;
  }
  if (typeof manifest.total_files === 'number' && manifest.total_files !== manifest.files.length) {
    errors.push(`COUNT_MISMATCH: total_files=${manifest.total_files} files.length=${manifest.files.length}`);
    failed++;
  }
  return { ok: failed === 0 && passed === manifest.files.length, passed, failed, total: manifest.files.length, errors };
}

const isDirectCli =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectCli) {
  const result = verifyManifestDirectory(process.cwd());
  for (const err of result.errors) {
    console.error(err);
  }
  console.log(
    `Manifest verification summary: ${result.passed} verified, ${result.failed} failed (total listed=${result.total}).`
  );
  if (!result.ok) {
    process.exit(1);
  }
}
