import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(), init: vi.fn(), secretValue: vi.fn(), portalValue: vi.fn(),
  cleanup: vi.fn(), info: vi.fn(), warn: vi.fn(), router: vi.fn(), createHttpApp: vi.fn(),
  region: { default: 'southamerica-west1' },
}));
vi.mock('firebase-admin/app', () => ({ initializeApp: mocks.initializeApp }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: mocks.secretValue }),
  defineString: (name: string) => name === 'NEXO_FUNCTIONS_REGION'
    ? mocks.region : { value: mocks.portalValue },
}));
vi.mock('firebase-functions/v2/core', () => ({ onInit: mocks.init }));
vi.mock('firebase-functions/v2/https', () => ({ onRequest: (_options: unknown, run: unknown) => ({ run }) }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (options: unknown, run: unknown) => ({ options, run }) }));
vi.mock('firebase-functions/logger', () => ({ info: mocks.info, warn: mocks.warn }));
vi.mock('../src/http', () => ({ createHttpApp: mocks.createHttpApp }));
vi.mock('../src/tv/pairing', () => ({ PairingService: class {} }));
vi.mock('../src/tv/cleanup', () => ({ cleanupTvPairings: mocks.cleanup }));

const summary = {
  scanned: 3, deletedExpired: 1, deletedConsumed: 1, skippedActive: 0,
  skippedInvalid: 1, skippedRetention: 0, skippedMissing: 0, errors: 0,
};

describe('scheduled function registration and secret isolation', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    mocks.cleanup.mockResolvedValue({ ...summary });
    mocks.createHttpApp.mockReturnValue(mocks.router);
    mocks.secretValue.mockReturnValue('local-test-only-secret');
  });

  it('runs daily in the backend region and logs only the summary without reading secrets', async () => {
    mocks.secretValue.mockImplementation(() => { throw new Error('cleanup must not read a secret'); });
    const { cleanupTvPairingsDaily } = await import('../src/index');
    await mocks.init.mock.calls[0][0]();
    const scheduled = cleanupTvPairingsDaily as unknown as {
      options: Record<string, unknown>; run: () => Promise<void>;
    };
    expect(scheduled.options).toMatchObject({
      schedule: '0 4 * * *', timeZone: 'UTC', region: mocks.region,
      maxInstances: 1, concurrency: 1, retryCount: 0,
    });
    expect(scheduled.options).not.toHaveProperty('secrets');
    await scheduled.run();
    expect(mocks.initializeApp).toHaveBeenCalledOnce();
    expect(mocks.secretValue).not.toHaveBeenCalled();
    expect(mocks.portalValue).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith('tv_pairings_cleanup', summary);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('keeps the API router cached and reads its secret only for API requests', async () => {
    const { api } = await import('../src/index');
    await mocks.init.mock.calls[0][0]();
    expect(mocks.secretValue).not.toHaveBeenCalled();
    const http = api as unknown as { run: (req: unknown, res: unknown) => void };
    http.run({}, {}); http.run({}, {});
    expect(mocks.createHttpApp).toHaveBeenCalledOnce();
    expect(mocks.secretValue).toHaveBeenCalledOnce();
    expect(mocks.router).toHaveBeenCalledTimes(2);
  });

  it('logs error counts and fails with a fixed message without provider details', async () => {
    mocks.cleanup.mockResolvedValue({ ...summary, errors: 1 });
    const { cleanupTvPairingsDaily } = await import('../src/index');
    const scheduled = cleanupTvPairingsDaily as unknown as { run: () => Promise<void> };
    await expect(scheduled.run()).rejects.toThrow('TV pairing cleanup completed with errors; inspect execution summary.');
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith('tv_pairings_cleanup', { ...summary, errors: 1 });
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
