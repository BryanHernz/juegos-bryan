import { ApiError, AppId } from '../tv/validation';
import { appId, assetId, assetPath, digest, exact, generation, hash, publicManifest,
  record, timestamp, validateManifest, versionId } from './manifest';

export const DOWNLOAD_TTL_MS = 5 * 60 * 1000;
export interface ReleaseAuth {
  verifyIdToken(token: string, checkRevoked: boolean): Promise<{ uid: string; firebase?: { sign_in_provider?: string } }>;
  getUser(uid: string): Promise<{ uid: string; disabled: boolean; providerData: { providerId: string }[] }>;
}
export interface StoredJson { bytes: Buffer; generation: string; sha256?: string }
export interface ReleaseStorage {
  read(path: string, generation?: string): Promise<StoredJson | null>;
  metadata(path: string, generation: string): Promise<{ size: number; sha256?: string; generation: string } | null>;
  sign(path: string, generation: string, fileName: string, expiresAt: number): Promise<string>;
}
export class ReleaseService {
  constructor(private readonly options: {
    auth: ReleaseAuth;
    access: (uid: string) => Promise<{ active?: unknown; apps?: Partial<Record<AppId, unknown>> } | undefined>;
    storage: ReleaseStorage; now?: () => number;
  }) {}

  async authorizePortal(token: string) {
    let uid: string;
    try {
      const decoded = await this.options.auth.verifyIdToken(token, true);
      const user = await this.options.auth.getUser(decoded.uid);
      if (user.disabled || user.uid !== decoded.uid || decoded.firebase?.sign_in_provider === 'anonymous' ||
        !user.providerData.some(p => p.providerId === 'password')) throw new Error('invalid_identity');
      uid = decoded.uid;
    } catch { throw new ApiError(401, 'authentication_required'); }
    let access;
    try { access = await this.options.access(uid); }
    catch { throw new ApiError(503, 'access_unavailable'); }
    if (access?.active !== true) throw new ApiError(403, 'access_denied');
    const apps = (['novaStar', 'cartonLleno'] as AppId[]).filter(app => access.apps?.[app] === true);
    if (!apps.length) throw new ApiError(403, 'access_denied');
    return apps;
  }

  async authorize(token: string, rawApp: unknown) {
    const apps = await this.authorizePortal(token);
    const app = appId(rawApp);
    if (!apps.includes(app)) throw new ApiError(403, 'access_denied');
    return app;
  }

  private async storedManifest(app: AppId, requested: string) {
    const requestedVersion = requested === 'latest' ? requested : versionId(requested);
    try {
      let version = requestedVersion, expectedHash: string | undefined, expectedGeneration: string | undefined;
      if (requested === 'latest') {
        const latest = await this.options.storage.read(`releases/${app}/latest.json`);
        if (!latest) throw new ApiError(404, 'release_not_found');
        if (digest(latest.bytes) !== latest.sha256) throw new Error('pointer_integrity');
        const p = record(JSON.parse(latest.bytes.toString('utf8')));
        exact(p, ['schemaVersion', 'app', 'version', 'manifestSha256', 'manifestGeneration', 'updatedAt']);
        if (p.schemaVersion !== 1 || p.app !== app || !hash(p.manifestSha256) ||
          !generation(p.manifestGeneration) || !timestamp(p.updatedAt)) throw new Error('invalid_pointer');
        version = versionId(p.version);
        expectedHash = p.manifestSha256;
        expectedGeneration = p.manifestGeneration;
      }
      const object = await this.options.storage.read(`releases/${app}/${version}/manifest.json`, expectedGeneration);
      if (!object) throw new ApiError(404, 'release_not_found');
      const actualHash = digest(object.bytes);
      if (actualHash !== object.sha256 || (expectedHash && expectedHash !== actualHash) ||
        (expectedGeneration && object.generation !== expectedGeneration)) throw new Error('manifest_integrity');
      return validateManifest(JSON.parse(object.bytes.toString('utf8')), app, version);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'release_not_found') throw error;
      throw new ApiError(503, 'release_integrity_error');
    }
  }

  async manifest(app: AppId, requested: string) { return publicManifest(await this.storedManifest(app, requested)); }

  async download(app: AppId, version: string, rawAssetId: unknown) {
    versionId(version);
    const id = assetId(rawAssetId);
    const m = await this.storedManifest(app, version);
    const asset = m.assets.find(a => a.id === id);
    if (!asset) throw new ApiError(404, 'asset_not_found');
    const path = assetPath(m, asset);
    try {
      const metadata = await this.options.storage.metadata(path, asset.generation);
      if (!metadata || metadata.size !== asset.size || metadata.sha256 !== asset.sha256 ||
        metadata.generation !== asset.generation) throw new Error('asset_integrity');
      const expires = (this.options.now?.() ?? Date.now()) + DOWNLOAD_TTL_MS;
      const url = await this.options.storage.sign(path, asset.generation, asset.filename, expires);
      return { url, expiresAt: new Date(expires).toISOString(), filename: asset.filename,
        size: asset.size, sha256: asset.sha256 };
    } catch { throw new ApiError(503, 'download_unavailable'); }
  }
}
