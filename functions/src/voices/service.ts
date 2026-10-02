import { ApiError } from '../tv/validation';
import { digest } from '../releases/manifest';
import { DOWNLOAD_TTL_MS, ReleaseStorage } from '../releases/service';
import { CATALOG_PATH, validateCatalog, voiceIdPattern, voiceObjectPath } from '../../voices-contract.cjs';

export interface Voice {
  id: string; name: string; label: string; version: string; language: string | null;
  gender: string; clips: number; size: number; bytes: number; sha256: string;
  filename: string; generation: string; downloadEndpoint: string;
}
export interface VoiceCatalog { schemaVersion: 1; app: 'cartonLleno'; updatedAt: string; voces: Voice[] }

// Auth/account revocation and current app access are checked by the shared
// release authorizer on every HTTP call, before reading the catalog or signing.
export class VoiceService {
  constructor(private readonly storage: ReleaseStorage, private readonly now: () => number = Date.now) {}

  async catalog(): Promise<VoiceCatalog> {
    try {
      const object = await this.storage.read(CATALOG_PATH);
      if (!object) throw new ApiError(404, 'voice_catalog_not_found');
      if (object.bytes.length > 65536 || digest(object.bytes) !== object.sha256) throw new Error('catalog_integrity');
      return validateCatalog(JSON.parse(object.bytes.toString('utf8'))) as VoiceCatalog;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'voice_catalog_integrity_error');
    }
  }

  async download(id: unknown) {
    if (typeof id !== 'string' || !voiceIdPattern.test(id)) throw new ApiError(400, 'invalid_voice_id');
    const catalog = await this.catalog();
    const voice = catalog.voces.find(v => v.id === id);
    if (!voice) throw new ApiError(404, 'voice_not_found');
    try {
      const object = voiceObjectPath(voice);
      const metadata = await this.storage.metadata(object, voice.generation);
      if (!metadata || metadata.generation !== voice.generation || metadata.size !== voice.size ||
        metadata.sha256 !== voice.sha256) throw new Error('voice_integrity');
      const expiresAt = this.now() + DOWNLOAD_TTL_MS;
      const url = await this.storage.sign(object, voice.generation, voice.filename, expiresAt);
      return { url, expiresAt: new Date(expiresAt).toISOString(), id: voice.id, version: voice.version,
        filename: voice.filename, size: voice.size, sha256: voice.sha256, generation: voice.generation };
    } catch { throw new ApiError(503, 'voice_download_unavailable'); }
  }
}
