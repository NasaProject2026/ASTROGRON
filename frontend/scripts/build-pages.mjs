import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const apiDir = path.join(root, 'app', 'api');
const proxyFile = path.join(root, 'proxy.ts');
const testsDir = path.join(root, 'tests');
const tsconfigFile = path.join(root, 'tsconfig.json');
const tempBackup = fs.mkdtempSync(path.join(os.tmpdir(), 'astrogron-pages-backup-'));
const movedApi = path.join(tempBackup, 'api');
const movedProxy = path.join(tempBackup, 'proxy.ts');
const movedTests = path.join(tempBackup, 'tests');
const originalTsconfig = fs.existsSync(tsconfigFile) ? fs.readFileSync(tsconfigFile, 'utf8') : null;

function restore() {
  if (fs.existsSync(movedApi) && !fs.existsSync(apiDir)) {
    fs.renameSync(movedApi, apiDir);
  }
  if (fs.existsSync(movedProxy) && !fs.existsSync(proxyFile)) {
    fs.renameSync(movedProxy, proxyFile);
  }
  if (fs.existsSync(movedTests) && !fs.existsSync(testsDir)) {
    fs.renameSync(movedTests, testsDir);
  }
  if (originalTsconfig !== null && fs.existsSync(tsconfigFile)) {
    fs.writeFileSync(tsconfigFile, originalTsconfig, 'utf8');
  }
  fs.rmSync(tempBackup, { recursive: true, force: true });
}

process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

function flattenSegmentDir(parentDir, nextDirName) {
  const rootPath = path.join(parentDir, nextDirName);
  const stack = [rootPath];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.txt')) {
        const relPosix = path.relative(rootPath, full).split(path.sep).join('.');
        const dest = path.join(parentDir, `${nextDirName}.${relPosix}`);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(full, dest);
        }
      }
    }
  }
  fs.rmSync(rootPath, { recursive: true, force: true });
}

/** Next.js 16 static export joins RSC segment paths using OS separators on Windows, producing nested `__next.*` folders instead of dot-separated `.txt` files. */
function normalizeStaticExportSegments(outDir) {
  const dirs = [outDir];
  while (dirs.length > 0) {
    const dir = dirs.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('__next.')) {
        flattenSegmentDir(dir, entry.name);
      } else {
        dirs.push(path.join(dir, entry.name));
      }
    }
  }
}

let exitCode = 1;
try {
  // Static export (output: 'export') cannot include dynamic API Route Handlers or Proxy middleware,
  // and tests/*.test.ts import API routes directly (typechecked separately via tsc/vitest).
  if (fs.existsSync(apiDir)) {
    fs.renameSync(apiDir, movedApi);
  }
  if (fs.existsSync(proxyFile)) {
    fs.renameSync(proxyFile, movedProxy);
  }
  if (fs.existsSync(testsDir)) {
    fs.renameSync(testsDir, movedTests);
  }

  const outDir = path.join(root, 'out');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(path.join(root, '.next-pages'), { recursive: true, force: true });

  const env = {
    ...process.env,
    GITHUB_PAGES_EXPORT: '1',
    NEXT_PUBLIC_STATIC_SHOWCASE: '1',
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH ?? '/ASTROGRON',
  };

  const nextCli = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  const res = spawnSync(process.execPath, [nextCli, 'build'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  exitCode = res.status ?? 1;

  if (exitCode === 0) {
    normalizeStaticExportSegments(outDir);
    // Ensure GitHub Pages serves static files cleanly without Jekyll filtering underscored _next assets.
    fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');
  }
} finally {
  restore();
}

process.exit(exitCode);
