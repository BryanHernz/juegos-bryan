import { createHash } from 'node:crypto';
import { ApiError, AppId, isApp } from '../tv/validation';
import { validateManifest as validateContract, idPattern } from '../../releases-contract.cjs';
export interface Asset {
  id: string; purpose: 'installer' | 'updater' | 'package'; variant: 'standard' | 'alias' | 'phone' | 'tv';
  platform: 'windows' | 'android'; architecture: string; format: 'exe' | 'zip' | 'apk';
  versionCode: number | null; filename: string; size: number; sha256: string; generation: string; downloadEndpoint: string;
}
export interface Manifest {
  schemaVersion: 1; app: AppId; version: string; build: number; releasedAt: string; notes: string;
  recommendations: { windows: string; phone: string; tv: string }; assets: Asset[];
}
export function digest(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
export function appId(value: unknown): AppId {
  if (!isApp(value)) throw new ApiError(400, 'invalid_app');
  return value;
}
export function versionId(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)) throw new ApiError(400, 'invalid_version');
  return value;
}
export function assetId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new ApiError(400, 'invalid_asset_id');
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_manifest');
  return value as Record<string, unknown>;
}
export function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('invalid_manifest');
}
export function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
export function generation(value: unknown): value is string { return typeof value === 'string' && /^[1-9]\d{0,24}$/.test(value); }
export function validateManifest(value: unknown, app: AppId, version: string): Manifest {
  return validateContract(value, app, version) as Manifest;
}
export function assetPath(m: Pick<Manifest, 'app' | 'version'>, a: Pick<Asset, 'id' | 'sha256' | 'filename'>) {
  return `releases/${m.app}/${m.version}/assets/${a.id}/${a.sha256}/${a.filename}`;
}
export function publicManifest(m: Manifest) { return m; }
