export const CATALOG_PATH: string;
export const voiceIdPattern: RegExp;
export function validateVoice(value: unknown): unknown;
export function validateCatalog(value: unknown): unknown;
export function voiceObjectPath(value: { id: string; sha256: string }): string;
