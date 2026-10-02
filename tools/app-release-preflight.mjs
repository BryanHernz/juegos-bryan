import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepare} from './publish-release.mjs';

// Publication metadata is explicit in the approved input, never guessed from a
// filename. This is tooling only; neither apps nor Hosting load this module.
export async function appReleasePreflight(app, root, inputPath) {
  if (!['novaStar','cartonLleno'].includes(app)) throw Error('Unsupported app');
  const pubspec = await readFile(path.join(root,'pubspec.yaml'),'utf8');
  const version = /^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$/m.exec(pubspec);
  const input = JSON.parse(await readFile(inputPath,'utf8'));
  if (!version || input.app!==app || input.version!==version[1] || input.build!==Number(version[2])) throw Error('App/version/build differs from pubspec');
  const plan = await prepare(input,path.dirname(path.resolve(inputPath)));
  const android = plan.assets.filter(a=>a.platform==='android');
  for (const abi of ['armeabi-v7a','arm64-v8a','x86_64']) {
    if (!android.some(a=>a.variant==='standard'&&a.architecture===abi)) throw Error('Missing explicit APK ABI: '+abi);
  }
  for(const [variant,abi] of [['phone','arm64-v8a'],['tv','armeabi-v7a']]) {
    const alias=android.find(a=>a.variant===variant&&a.architecture===abi);
    const original=android.find(a=>a.variant==='standard'&&a.architecture===abi);
    if (!alias||alias.sha256!==original.sha256||alias.size!==original.size) throw Error('Alias does not match approved ABI: '+variant);
  }
  if(!plan.assets.some(a=>a.platform==='windows'&&a.purpose==='installer'&&a.architecture==='x64')) throw Error('Missing Windows installer x64');
  const metadata = plan.compatibility.find(a=>a.fileName==='version.json');
  const legacy = JSON.parse(await readFile(metadata.localPath,'utf8'));
  if (legacy.version!==plan.version || legacy.build!==plan.build) throw Error('Original version.json differs from app');
  return {app,version:plan.version,build:plan.build,assets:plan.assets.length,hashesVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  appReleasePreflight(...process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{
    console.error('Preflight failed: check app version, explicit asset contract, ABI aliases and approved hashes.'); process.exitCode=1;
  });
}
