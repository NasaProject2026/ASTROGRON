/** Offline verification of packaging, link traversal, and optional orbital preview syntax. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateManifestRelativePath, verifyManifestDirectory } from './verify-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astragron-portable-review-'));
let checks = 0;
function check(label, callback) { callback(); checks++; console.log(`PASS ${label}`); }
function manifest(files) { fs.writeFileSync(path.join(temp,'manifest.json'), JSON.stringify({ total_files:files.length, files })); }
function item(name) { const b=fs.readFileSync(path.join(temp,name)); return {path:name,size_bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}; }
try {
  check('original path validators disallow absolute and traversal paths', () => {
    for(const value of ['../outside.txt', 'part/../outside.txt', '/etc/passwd', 'C:\\Windows\\file.txt', 'C:relative.txt']) assert.equal(validateManifestRelativePath(value).valid, false);
  });
  fs.writeFileSync(path.join(temp,'sample.txt'),'expected SHA-256 content');
  manifest([item('sample.txt')]);
  check('clean archive fixture passes',()=>assert.equal(verifyManifestDirectory(temp,'manifest.json').ok,true));
  check('tampered content fails',()=>{
    fs.writeFileSync(path.join(temp,'sample.txt'),'modified content');
    const outcome=verifyManifestDirectory(temp,'manifest.json');
    assert.equal(outcome.ok,false);assert.ok(outcome.errors.some(x=>x.includes('SIZE_MISMATCH')||x.includes('SHA256_MISMATCH')));
    fs.writeFileSync(path.join(temp,'sample.txt'),'expected SHA-256 content');
  });
  check('duplicate entries fail',()=>{
    manifest([item('sample.txt'),item('sample.txt')]);
    assert.equal(verifyManifestDirectory(temp,'manifest.json').ok,false);
    manifest([item('sample.txt')]);
  });
  check('manifest path escaping root fails',()=>assert.equal(verifyManifestDirectory(temp,'../manifest.json').ok,false));
  check('malformed manifest JSON fails gracefully',()=>{
    fs.writeFileSync(path.join(temp,'broken.json'),'{ not JSON');
    const result=verifyManifestDirectory(temp,'broken.json');assert.equal(result.ok,false);assert.ok(result.errors[0].includes('INVALID_MANIFEST_JSON'));
  });
  check('symlinked parent directory cannot bypass containment',()=>{
    const outer=fs.mkdtempSync(path.join(os.tmpdir(),'astragron-outside-'));
    try {
      fs.writeFileSync(path.join(outer,'stolen.txt'),'external payload');
      let supported=true;
      try { fs.symlinkSync(outer,path.join(temp,'linked'),'dir'); } catch (err) { if(['EPERM','EACCES','ENOTSUP'].includes(err?.code)) supported=false; else throw err; }
      if(supported){ manifest([{path:'linked/stolen.txt',size_bytes:16,sha256:'x'}]); const result=verifyManifestDirectory(temp,'manifest.json');assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.includes('SYMLINK_OR_NON_FILE'))); }
    } finally {fs.rmSync(outer,{recursive:true,force:true});}
  });
  check('orbit prototype JavaScript parses correctly without external npm packages',()=>{
    const html=fs.readFileSync(path.join(root,'public/orbit-lab.html'),'utf8');
    const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(js);new vm.Script(js,{filename:'orbit-lab.html'});
    assert.match(html,/Natural Earth|LAND_POLYGONS/);assert.match(html,/requestAnimationFrame/);assert.match(html,/prefers-reduced-motion/);
  });
  check('all listed shipped assets exist',()=>{
    const assets=JSON.parse(fs.readFileSync(path.join(root,'assets-manifest.json'),'utf8'));
    for(const asset of assets.assets) assert.ok(fs.statSync(path.join(root,asset.path)).isFile(),asset.path);
  });
  check('runtime Next.js version is at patched 16.4.6 release',()=>{
    const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
    assert.equal(lock.packages['node_modules/next'].version,'16.4.6');
  });
  const packaged=verifyManifestDirectory(root);
  check('complete portable archive manifest matches current source',()=>{assert.equal(packaged.ok,true,packaged.errors.join('\n'));});
  console.log(`\nAll ${checks} offline portable regression checks PASS.`);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
