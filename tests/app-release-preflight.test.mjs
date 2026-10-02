import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {appReleasePreflight} from '../tools/app-release-preflight.mjs';

async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'nexo-app-preflight-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(path.join(dir,'pubspec.yaml'),'version: 1.0.31+1033\n');
  const input={app:'novaStar',version:'1.0.31',build:1033,releasedAt:'2026-10-02T00:00:00.000Z',notes:'Approved fixture',assets:[],compatibility:[],recommendations:{}};
  for(const [platform,purpose,variant,architecture,format] of [
    ['windows','installer','standard','x64','exe'],['windows','updater','standard','x64','zip'],
    ...['armeabi-v7a','arm64-v8a','x86_64'].map(abi=>['android','package','standard',abi,'apk']),
    ['android','package','phone','arm64-v8a','apk'],['android','package','tv','armeabi-v7a','apk'],
  ]) {
    const id=`novaStar-1.0.31-${purpose}-${variant}-${architecture}`;
    const filename=id+'.'+format;
    const bytes=Buffer.from('approved test artifact '+architecture);
    await writeFile(path.join(dir,filename),bytes);
    input.assets.push({id,platform,purpose,variant,architecture,format,versionCode:platform==='android'?3033:null,filename,path:filename,sha256:createHash('sha256').update(bytes).digest('hex')});
    if(purpose==='installer'||variant==='phone'||variant==='tv')input.recommendations[purpose==='installer'?'windows':variant]=id;
  }
  const metadata=Buffer.from(JSON.stringify({version:'1.0.31',build:1033}));
  await writeFile(path.join(dir,'version.json'),metadata);
  input.compatibility.push({path:'version.json',fileName:'version.json',sha256:createHash('sha256').update(metadata).digest('hex')});
  const file=path.join(dir,'input.json');
  const save=()=>writeFile(file,JSON.stringify(input));
  await save();
  return {dir,file,input,save};
}
test('app publication checks real bytes, explicit ABI assets, aliases and matching version.json offline',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await appReleasePreflight('novaStar',f.dir,f.file),{app:'novaStar',version:'1.0.31',build:1033,assets:7,hashesVerified:true});
});
test('mismatched version/app, missing ABI, swapped phone alias and tampered bytes stop publication',async t=>{
  const f=await fixture(t);
  await assert.rejects(appReleasePreflight('cartonLleno',f.dir,f.file),/differs/);
  await writeFile(path.join(f.dir,'pubspec.yaml'),'version: 1.0.32+1034\n');
  await assert.rejects(appReleasePreflight('novaStar',f.dir,f.file),/differs/);
  await writeFile(path.join(f.dir,'pubspec.yaml'),'version: 1.0.31+1033\n');
  const original=f.input.assets;
  f.input.assets=original.filter(a=>a.architecture!=='x86_64');await f.save();
  await assert.rejects(appReleasePreflight('novaStar',f.dir,f.file),/Missing explicit APK ABI/);
  f.input.assets=original;
  const phone=original.find(a=>a.variant==='phone');
  const source=original.find(a=>a.variant==='standard'&&a.architecture==='armeabi-v7a');
  phone.sha256=source.sha256;phone.path=source.path;await f.save();
  await assert.rejects(appReleasePreflight('novaStar',f.dir,f.file),/Alias/);
  await writeFile(path.join(f.dir,source.path),'altered');
  await assert.rejects(appReleasePreflight('novaStar',f.dir,f.file),/mismatch/);
});
