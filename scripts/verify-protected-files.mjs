#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const list = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'review/SMART_FIELD_PROTECTED_HASHES.json'), 'utf8')
);
let pass = 0;
for (const item of list) {
  const fullPath = path.join(ROOT, item.file);
  const buf = fs.readFileSync(fullPath);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== item.sha256 || buf.length !== item.bytes) {
    console.error(`PROTECTED FILE MISMATCH: ${item.file}`);
    process.exit(1);
  }
  pass++;
}
console.log(`Protected files verified: ${pass}/${list.length} PASS`);
