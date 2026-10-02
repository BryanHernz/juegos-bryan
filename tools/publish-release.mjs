import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, mkdtemp, readdir, stat, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const REPOS = { novaStar: 'BryanHernz/nova-star-versiones', cartonLleno: 'BryanHernz/carton-lleno-versiones' };
import { validateManifest } from '../functions/releases-contract.cjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export async function hashRemoteStream(createStream) {
  for (let attempt = 0; ; attempt++) {
    const hash = createHash('sha256');
    try {
      for await (const bytes of createStream()) hash.update(bytes);
      return hash.digest('hex');
    } catch (error) {
      // Retry only interrupted reads of the same immutable generation. Discard
      // partial bytes; permission and CRC/SHA integrity failures must still abort.
      if (attempt >= 2 || !['ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}
class PublicationError extends Error {}
function fail(message) { throw new PublicationError(message); }
async function removeTemporary(directory) {
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('nexo-release-')) fail('Invalid temporary directory');
  await rm(directory, { recursive: true, force: true });
}
function validName(name) { return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name); }
function version(value) {
  return typeof value === 'string' && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value);
}
export function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
export async function prepare(input, directory) {
  if (!Object.hasOwn(REPOS, input.app) || !version(input.version) ||
    !Number.isSafeInteger(input.build) || input.build < 1 ||
    typeof input.releasedAt !== 'string' || new Date(input.releasedAt).toISOString() !== input.releasedAt ||
    typeof input.notes !== 'string' || input.notes.length > 12000 ||
    !Array.isArray(input.assets) || !input.assets.length || input.assets.length > 32 || !Array.isArray(input.compatibility)) fail('Invalid publication input');
  const names = new Set();
  async function file(entry) {
    if (!validName(entry.fileName) || names.has(entry.fileName) || typeof entry.path !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('Invalid or duplicate artifact');
    names.add(entry.fileName);
    const localPath = path.resolve(directory, entry.path);
    const info = await stat(localPath);
    if (!info.isFile() || info.size < 1 || info.size > 4 * 1024 ** 3 || await hashFile(localPath) !== entry.sha256) fail('Local artifact SHA256/size mismatch');
    return { fileName: entry.fileName, sha256: entry.sha256, size: info.size, localPath };
  }
  const assets = [];
  for (const entry of input.assets) {
    const { fileName, ...checked } = await file({ ...entry, fileName: entry.filename });
    void fileName;
    assets.push({ ...checked, id: entry.id, purpose: entry.purpose, variant: entry.variant,
      platform: entry.platform, architecture: entry.architecture, format: entry.format, versionCode: entry.versionCode, filename: entry.filename,
      downloadEndpoint: `/api/v1/releases/${input.app}/${input.version}/download/${entry.id}` });
  }
  validateManifest({ schemaVersion: 1, app: input.app, version: input.version, build: input.build,
    releasedAt: input.releasedAt, notes: input.notes, recommendations: input.recommendations,
    assets: assets.map(({ localPath, ...asset }) => ({ ...asset, generation: '1' })) }, input.app, input.version);
  const compatibility = [];
  for (const entry of input.compatibility) compatibility.push(await file(entry));
  if (!compatibility.some(a => a.fileName === 'version.json') || (input.app === 'novaStar' && !assets.some(a => a.purpose === 'updater'))) {
    fail('Transition requires original version.json and updater ZIP; never generate/rewrite them here');
  }
  return { app: input.app, version: input.version, build: input.build, releasedAt: input.releasedAt,
    notes: input.notes, recommendations: input.recommendations, repo: REPOS[input.app], assets, compatibility };
}
function artifactPath(plan, asset) {
  return `releases/${plan.app}/${plan.version}/assets/${asset.id}/${asset.sha256}/${asset.filename}`;
}
function manifestFrom(plan, generations) {
  return { schemaVersion: 1, app: plan.app, version: plan.version, build: plan.build,
    releasedAt: plan.releasedAt, notes: plan.notes, recommendations: plan.recommendations,
    assets: plan.assets.map(({ localPath: ignored, ...a }, i) => {
      void ignored; return { ...a, generation: generations[i] };
    }) };
}

// Injected adapters keep dry-run fully offline and make interruption/retries
// testable. No object/release deletion, compilation, IAM mutation or --clobber.
export async function publish(plan, { mode, storage, github, now = () => new Date().toISOString() }) {
  if (!['dry-run', 'verify', 'publish', 'import-existing', 'publish-private', 'verify-private'].includes(mode)) fail('Invalid mode');
  const privateOnly = mode === 'publish-private' || mode === 'verify-private';
  const readOnly = mode === 'verify' || mode === 'verify-private';
  if (mode === 'dry-run') return {
    mode, app: plan.app, version: plan.version, repo: plan.repo,
    artifacts: plan.assets.map(a => ({ filename: a.filename, size: a.size, sha256: a.sha256, object: artifactPath(plan, a) })),
    compatibility: plan.compatibility.map(a => a.fileName),
    manifest: `releases/${plan.app}/${plan.version}/manifest.json`, latest: `releases/${plan.app}/latest.json`,
    writes: false,
  };
  await storage.assertPrivate();
  const latestPath = `releases/${plan.app}/latest.json`;
  const oldLatest = await storage.read(latestPath);
  if (oldLatest) {
    const old = JSON.parse(oldLatest.bytes);
    if (old.app !== plan.app || !version(old.version) || !/^[a-f0-9]{64}$/.test(old.manifestSha256) ||
      !/^[1-9]\d*$/.test(old.manifestGeneration)) fail('Invalid current latest pointer');
    if (compareVersions(plan.version, old.version) < 0) fail('Refusing latest downgrade');
  }
  if (!privateOnly) await github.ensure(plan, mode === 'import-existing' ? 'verify' : mode);
  const generations = [];
  for (const asset of plan.assets) {
    const object = artifactPath(plan, asset);
    let existing = await storage.readMetadata(object);
    if (!existing) {
      if (readOnly) fail('Private artifact missing');
      // Rehash immediately before uploading, then verify remote bytes, not only metadata.
      if (await hashFile(asset.localPath) !== asset.sha256) fail('Local artifact changed');
      await storage.upload(object, { ...asset, app: plan.app, version: plan.version,
        build: plan.build, releasedAt: plan.releasedAt }, { ifGenerationMatch: 0 });
      existing = await storage.readMetadata(object);
    }
    if (!existing || existing.size !== asset.size || existing.sha256 !== asset.sha256 ||
      await storage.hash(object, existing.generation) !== asset.sha256) fail('Remote artifact SHA256/size mismatch');
    generations.push(existing.generation);
  }
  // Archive original updater metadata/scripts as private, immutable support
  // objects. They are never exposed as selectable download assets.
  for (const file of plan.compatibility) {
    const object = `releases/${plan.app}/${plan.version}/support/${file.sha256}/${file.fileName}`;
    let existing = await storage.readMetadata(object);
    if (!existing) {
      if (readOnly) fail('Private support artifact missing');
      if (await hashFile(file.localPath) !== file.sha256) fail('Local support artifact changed');
      await storage.upload(object, { ...file, filename: file.fileName, app: plan.app,
        version: plan.version, build: plan.build, releasedAt: plan.releasedAt });
      existing = await storage.readMetadata(object);
    }
    if (!existing || existing.size !== file.size || existing.sha256 !== file.sha256 ||
      await storage.hash(object, existing.generation) !== file.sha256) fail('Remote support SHA256/size mismatch');
  }
  const manifest = manifestFrom(plan, generations);
  validateManifest(manifest, plan.app, plan.version);
  const manifestPath = `releases/${plan.app}/${plan.version}/manifest.json`;
  const bytes = jsonBytes(manifest);
  let stored = await storage.read(manifestPath);
  if (!stored) {
    if (readOnly) fail('Private manifest missing');
    await storage.write(manifestPath, bytes, 0);
    stored = await storage.read(manifestPath);
  }
  if (!stored || !stored.bytes.equals(bytes) || stored.sha256 !== sha(bytes)) fail('Immutable manifest mismatch');
  const pointer = { schemaVersion: 1, app: plan.app, version: plan.version,
    manifestSha256: sha(bytes), manifestGeneration: stored.generation, updatedAt: now() };
  const old = oldLatest && JSON.parse(oldLatest.bytes);
  const matches = old && old.version === pointer.version && old.manifestSha256 === pointer.manifestSha256 &&
    old.manifestGeneration === pointer.manifestGeneration;
  if (!matches) {
    if (readOnly) fail('Latest does not identify the verified manifest');
    // Compare-and-swap prevents concurrent publishers from silently overwriting latest.
    await storage.write(latestPath, jsonBytes(pointer), oldLatest?.generation ?? 0);
  }
  const checked = await storage.read(latestPath);
  const final = checked && JSON.parse(checked.bytes);
  if (!final || final.version !== pointer.version || final.manifestSha256 !== pointer.manifestSha256 ||
    final.manifestGeneration !== pointer.manifestGeneration) fail('Latest verification failed');
  if (!privateOnly && mode !== 'import-existing') await github.activate?.(plan, mode);
  return { mode, app: plan.app, version: plan.version, verified: true, artifacts: generations.length,
    supportArtifacts: plan.compatibility.length, manifest: manifestPath, latest: latestPath };
}

export async function cloudAdapter(bucketName) {
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const adminRequire = createRequire(require.resolve('firebase-admin/storage'));
  const { Storage } = adminRequire('@google-cloud/storage');
  const storageRequire = createRequire(adminRequire.resolve('@google-cloud/storage'));
  const { OAuth2Client, Impersonated } = storageRequire('google-auth-library');
  // Use the explicit gcloud operator identity, rather than ambient ADC which
  // may already impersonate the read-only runtime. Tokens stay only in memory.
  const sourceClient = new OAuth2Client();
  sourceClient.refreshHandler = async () => {
    const sdk = process.env.NEXO_GCLOUD_SDK || path.join(process.env.LOCALAPPDATA || '', 'Google', 'Cloud SDK', 'google-cloud-sdk');
    const result = process.platform === 'win32' ? await exec(path.join(sdk, 'platform', 'bundledpython', 'python.exe'), [
      path.join(sdk, 'lib', 'gcloud.py'),
      'auth', 'print-access-token',
    ], { maxBuffer: 65536, timeout: 120000, windowsHide: true }) : await exec('gcloud', ['auth', 'print-access-token'], { maxBuffer: 65536, timeout: 120000 });
    const token = result.stdout.trim();
    if (!token || /\s/.test(token)) fail('gcloud did not return an operator token');
    return { access_token: token, expiry_date: Date.now() + 3000000 };
  };
  sourceClient.setCredentials(await sourceClient.refreshHandler());
  const authClient = new Impersonated({ sourceClient,
    targetPrincipal: 'nexo-release-publisher@nova-star-bd0d9.iam.gserviceaccount.com',
    targetScopes: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: 3600 });
  const bucket = new Storage({ projectId: 'nova-star-bd0d9', authClient }).bucket(bucketName);
  const missing = error => error?.code === 404;
  return {
    async assertPrivate() {
      const [metadata] = await bucket.getMetadata();
      const [policy] = await bucket.iam.getPolicy({ requestedPolicyVersion: 3 });
      if (String(metadata.projectNumber) !== '870971438774' ||
        metadata.iamConfiguration?.publicAccessPrevention !== 'enforced' ||
        metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true ||
        policy.bindings?.some(b => b.members?.some(m => ['allUsers', 'allAuthenticatedUsers'].includes(m)))) {
        fail('Bucket must belong to Nexo, use uniform IAM and enforced public access prevention, without public principals');
      }
    },
    async readMetadata(object) {
      try {
        const [m] = await bucket.file(object).getMetadata();
        return { size: Number(m.size), generation: String(m.generation), sha256: m.metadata?.sha256 };
      } catch (error) { if (missing(error)) return null; throw error; }
    },
    async read(object) {
      const m = await this.readMetadata(object);
      if (!m) return null;
      if (m.size > 65536) fail('Manifest/pointer too large');
      const [bytes] = await bucket.file(object, { generation: m.generation }).download({ validation: 'crc32c' });
      if (bytes.length > 65536 || m.sha256 !== sha(bytes)) fail('Manifest/pointer integrity mismatch');
      return { ...m, bytes };
    },
    async hash(object, generation) {
      return hashRemoteStream(() => bucket.file(object, { generation }).createReadStream({ validation: 'crc32c' }));
    },
    async sign(object, generation, filename, expiresAt) {
      const [url] = await bucket.file(object, { generation }).getSignedUrl({
        version: 'v4', action: 'read', expires: expiresAt, queryParams: { generation },
        responseDisposition: `attachment; filename="${filename}"`,
      });
      return url;
    },
    async upload(object, asset) {
      await bucket.upload(asset.localPath, { destination: object, validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store',
          metadata: { sha256: asset.sha256, app: asset.app, version: asset.version,
            build: String(asset.build), ...(asset.platform ? { platform: asset.platform, architecture: asset.architecture,
              purpose: asset.purpose, variant: asset.variant, format: asset.format,
              versionCode: asset.versionCode === null ? 'none' : String(asset.versionCode) } : { purpose: 'support' }),
            originalName: asset.filename, releasedAt: asset.releasedAt } } });
    },
    async uploadVoice(object, voice) {
      await bucket.upload(voice.localPath, { destination: object, validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'application/zip', cacheControl: 'private, no-store',
          metadata: { sha256: voice.sha256, app: 'cartonLleno', purpose: 'voice',
            voiceId: voice.id, voiceVersion: voice.version, originalName: voice.filename } } });
    },
    async write(object, bytes, expectedGeneration) {
      await bucket.file(object).save(bytes, { resumable: false, validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: expectedGeneration },
        metadata: { contentType: 'application/json', cacheControl: 'private, no-store', metadata: { sha256: sha(bytes) } } });
    },
  };
}
export function githubAdapter(run = args => exec('gh', args, { maxBuffer: 1024 * 1024 })) {
  const releases = new Map();
  const assertPrivate = async plan => {
    const repo = JSON.parse((await run(['api', `repos/${plan.repo}`])).stdout);
    if (repo.private !== true || repo.full_name !== plan.repo) fail('Historical releases require the expected private repository');
  };
  return { async ensure(plan, mode) {
    if (mode === 'publish') await assertPrivate(plan);
    const tag = `v${plan.version}`;
    // The tag endpoint excludes drafts. Scan every authenticated list page so
    // retries resume an existing draft, even after an interrupted creation.
    const matches = [];
    for (let page = 1; ; page++) {
      const listed = JSON.parse((await run(['api', `repos/${plan.repo}/releases?per_page=100&page=${page}`])).stdout);
      if (!Array.isArray(listed)) fail('Invalid GitHub release list');
      matches.push(...listed.filter(r => r.tag_name === tag));
      if (listed.length < 100) break;
    }
    if (matches.length > 1) fail('Multiple GitHub releases share this tag; review manually before publishing');
    let release = matches[0];
    if (!release) {
      if (mode !== 'publish') fail('GitHub release missing');
      const directory = await mkdtemp(path.join(tmpdir(), 'nexo-release-notes-'));
      try {
        const input = path.join(directory, 'release.json');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(input, jsonBytes({ tag_name: tag, name: tag, body: plan.notes, draft: true, prerelease: false }));
        // Creation returns the draft ID directly; no second lookup by tag.
        release = JSON.parse((await run(['api', `repos/${plan.repo}/releases`, '--method', 'POST', '--input', input])).stdout);
      } finally { await removeTemporary(directory); }
    }
    if ((release.draft && mode !== 'publish') || release.prerelease || release.tag_name !== tag ||
      !Number.isSafeInteger(release.id) || release.id < 1 || typeof release.draft !== 'boolean') fail('Invalid GitHub transition release');
    releases.set(`${plan.repo}:${tag}`, { id: release.id, draft: release.draft });
    try {
      const latest = JSON.parse((await run(['api', `repos/${plan.repo}/releases/latest`])).stdout);
      const latestVersion = latest.tag_name?.replace(/^v/, '');
      if (!version(latestVersion) || compareVersions(plan.version, latestVersion) < 0) fail('Refusing GitHub latest downgrade or unknown version');
    } catch (error) {
      if (!String(error.stderr).includes('HTTP 404')) throw error;
    }
    const files = [...plan.assets.map(a => ({ ...a, fileName: a.filename })), ...plan.compatibility];
    // The assets endpoint is paginated; never assume a release has <=30 assets.
    const list = async () => {
      const remote = [];
      for (let page = 1; ; page++) {
        const assets = JSON.parse((await run(['api', `repos/${plan.repo}/releases/${release.id}/assets?per_page=100&page=${page}`])).stdout);
        remote.push(...assets);
        if (assets.length < 100) return remote;
      }
    };
    let remote = await list();
    for (const file of files) {
      let asset = remote.find(a => a.name === file.fileName);
      if (!asset) {
        if (mode !== 'publish') fail('GitHub compatibility artifact missing');
        if (await hashFile(file.localPath) !== file.sha256) fail('Local artifact changed');
        const staging = await mkdtemp(path.join(tmpdir(), 'nexo-release-stage-'));
        try {
          const staged = path.join(staging, file.fileName);
          await copyFile(file.localPath, staged);
          if (await hashFile(staged) !== file.sha256) fail('Local artifact changed');
          await run(['release', 'upload', tag, staged, '--repo', plan.repo]);
        } finally { await removeTemporary(staging); }
        remote = await list();
        asset = remote.find(a => a.name === file.fileName);
      }
      if (!asset || asset.state !== 'uploaded' || asset.size !== file.size) fail('GitHub artifact mismatch');
      // Download and hash the actual bytes even when GitHub supplies a digest.
      const directory = await mkdtemp(path.join(tmpdir(), 'nexo-release-verify-'));
      try {
        await run(['release', 'download', tag, '--repo', plan.repo, '--pattern', file.fileName, '--dir', directory]);
        if ((await readdir(directory)).length !== 1 || await hashFile(path.join(directory, file.fileName)) !== file.sha256) fail('GitHub artifact SHA256 mismatch');
      } finally { await removeTemporary(directory); }
    }
    return release.id;
  }, async activate(plan, mode) {
    if (mode === 'publish') await assertPrivate(plan);
    const tag = `v${plan.version}`;
    const release = releases.get(`${plan.repo}:${tag}`);
    if (mode === 'publish' && !release) fail('GitHub release must be verified before activation');
    if (mode === 'publish' && release.draft) {
      const published = JSON.parse((await run(['api', `repos/${plan.repo}/releases/${release.id}`,
        '--method', 'PATCH', '--field', 'draft=false', '--raw-field', 'make_latest=true'])).stdout);
      if (published.id !== release.id || published.tag_name !== tag || published.draft !== false || published.prerelease) fail('GitHub release activation failed');
      releases.set(`${plan.repo}:${tag}`, { id: release.id, draft: false });
    }
    const latest = JSON.parse((await run(['api', `repos/${plan.repo}/releases/latest`])).stdout);
    if (latest.tag_name !== tag) fail('GitHub latest verification failed');
  } };
}

export async function main(args) {
  const [modeFlag, inputPath, bucketName, ...extra] = args;
  const mode = modeFlag?.replace(/^--/, '');
  if (!['dry-run', 'verify', 'publish', 'import-existing', 'publish-private', 'verify-private'].includes(mode) || !inputPath || extra.length ||
    (mode !== 'dry-run' && !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucketName ?? ''))) {
    fail('Usage: node tools/publish-release.mjs --dry-run|--verify|--publish|--import-existing|--publish-private|--verify-private input.json [private-bucket]');
  }
  const plan = await prepare(JSON.parse(await readFile(inputPath, 'utf8')), path.dirname(path.resolve(inputPath)));
  const storage = mode === 'dry-run' ? undefined : await cloudAdapter(bucketName);
  const result = await publish(plan, { mode, storage,
    github: ['dry-run', 'publish-private', 'verify-private'].includes(mode) ? undefined : githubAdapter() });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Provider exceptions may contain signed URLs or credential details.
    console.error(error instanceof PublicationError ? error.message :
      'Publication stopped: input or provider failure. Check file paths, ADC/gh authentication and scoped permissions.');
    process.exitCode = 1;
  });
}
