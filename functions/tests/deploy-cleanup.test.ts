import { describe, expect, it, vi } from 'vitest';
import {
  TARGET, deployArguments, desiredJob, nextExecution, parseMode, runWorkflow,
} from '../deploy-cleanup.mjs';

const NOW = Date.parse('2026-10-01T21:00:00Z');
const URI = 'https://cleanuptvpairingsdaily-jfqflryoka-tl.a.run.app';
function fixture() {
  const fn = {
    name: `projects/${TARGET.project}/locations/${TARGET.functionRegion}/functions/${TARGET.function}`,
    environment: 'GEN_2', state: 'ACTIVE',
    buildConfig: { runtime: 'nodejs22', entryPoint: TARGET.function,
      serviceAccount: 'projects/nova-star-bd0d9/serviceAccounts/build-account@example.test' },
    serviceConfig: { uri: URI,
      service: `projects/${TARGET.project}/locations/${TARGET.functionRegion}/services/cleanuptvpairingsdaily`,
      serviceAccountEmail: TARGET.serviceAccount, timeoutSeconds: 300, availableMemory: '256Mi',
      maxInstanceCount: 1, maxInstanceRequestConcurrency: 1 },
  };
  let job: Record<string, unknown> | null = {
    ...desiredJob(fn), state: 'ENABLED', scheduleTime: '2026-10-02T04:00:00Z',
  };
  const policy = { bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${TARGET.serviceAccount}`] }] };
  const io = {
    now: () => NOW,
    validateLocal: vi.fn(async () => undefined),
    getFunction: vi.fn(async () => structuredClone(fn)),
    getInvoker: vi.fn(async () => structuredClone(policy)),
    getLocations: vi.fn(async () => ['southamerica-east1']),
    getJob: vi.fn(async () => structuredClone(job)),
    deployFunction: vi.fn(async (args: string[]) => { void args; }),
    createJob: vi.fn(async (value: Record<string, unknown>) => {
      job = { ...value, state: 'ENABLED', scheduleTime: '2026-10-02T04:00:00Z' };
    }),
    updateJob: vi.fn(async (value: Record<string, unknown>, mask: string[]) => {
      void mask;
      job = { ...job, ...value };
    }),
  };
  return { io, fn, policy, setJob: (value: Record<string, unknown> | null) => { job = value; },
    getJob: () => structuredClone(job) };
}

describe('official cleanup deploy/verify procedure (mocked cloud IO)', () => {
  it('defaults to verification and rejects ambiguous/destructive CLI arguments', () => {
    expect(parseMode([])).toBe('verify');
    expect(parseMode(['--dry-run'])).toBe('dry-run');
    expect(() => parseMode(['--deploy', '--verify'])).toThrow('Usage:');
    expect(() => parseMode(['--force'])).toThrow('Usage:');
  });

  it('dry-run is offline and cannot deploy, access IAM or invoke cleanup', async () => {
    const result = await runWorkflow('dry-run', {});
    expect(result).toMatchObject({ mutations: false, cloudReads: false, invokesCleanup: false,
      functionRegion: 'southamerica-west1', schedulerLocation: 'southamerica-east1' });
    expect(result.functionDeploy).not.toContain('firebase');
  });

  it('verifies split locations, schedule and next execution without mutations', async () => {
    const f = fixture();
    expect(await runWorkflow('verify', f.io)).toMatchObject({
      schedulerAction: 'unchanged', functionRegion: 'southamerica-west1', schedulerLocation: 'southamerica-east1',
      schedule: '0 4 * * *', timeZone: 'UTC', nextExecution: '2026-10-02T04:00:00Z', iamModified: false,
    });
    expect(f.io.deployFunction).not.toHaveBeenCalled();
    expect(f.io.createJob).not.toHaveBeenCalled();
    expect(f.io.updateJob).not.toHaveBeenCalled();
    expect(f.io.validateLocal).not.toHaveBeenCalled();
  });

  it('deploy uses only the approved function and skips Scheduler writes if already correct', async () => {
    const f = fixture();
    await runWorkflow('deploy', f.io);
    const args = f.io.deployFunction.mock.calls[0][0];
    expect(args.slice(0, 3)).toEqual(['functions', 'deploy', 'cleanupTvPairingsDaily']);
    expect(args).toContain('--region=southamerica-west1');
    expect(args).toContain('--entry-point=cleanupTvPairingsDaily');
    expect(args).toContain('--update-build-env-vars=GOOGLE_NODE_RUN_SCRIPTS=');
    expect(args).toContain('--build-service-account=projects/nova-star-bd0d9/serviceAccounts/build-account@example.test');
    expect(args).not.toContain('--allow-unauthenticated');
    expect(f.io.validateLocal).toHaveBeenCalledOnce();
    expect(f.io.createJob).not.toHaveBeenCalled();
    expect(f.io.updateJob).not.toHaveBeenCalled();
  });

  it('creates a missing job in east1 and a second execution does not create another', async () => {
    const f = fixture(); f.setJob(null);
    expect(await runWorkflow('deploy', f.io)).toMatchObject({ schedulerAction: 'created' });
    const job = f.io.createJob.mock.calls[0][0];
    expect(job.name).toContain('/locations/southamerica-east1/');
    expect(job).toMatchObject({ schedule: '0 4 * * *', timeZone: 'UTC',
      httpTarget: { uri: URI, httpMethod: 'POST', oidcToken: { serviceAccountEmail: TARGET.serviceAccount } } });
    expect(await runWorkflow('deploy', f.io)).toMatchObject({ schedulerAction: 'unchanged' });
    expect(f.io.createJob).toHaveBeenCalledOnce();
  });

  it('reconciles only approved job fields and becomes a no-op on repetition', async () => {
    const f = fixture(); f.setJob({ ...f.getJob(), schedule: '0 5 * * *', timeZone: 'America/Santiago' });
    expect(await runWorkflow('deploy', f.io)).toMatchObject({ schedulerAction: 'updated' });
    expect(f.io.updateJob.mock.calls[0][1]).toEqual(['schedule', 'timeZone']);
    expect(await runWorkflow('deploy', f.io)).toMatchObject({ schedulerAction: 'unchanged' });
    expect(f.io.updateJob).toHaveBeenCalledOnce();
  });

  it('accepts Google URI trailing slash and omitted zero retry defaults', async () => {
    const f = fixture();
    f.setJob({ ...f.getJob(), httpTarget: { uri: `${URI}/`, httpMethod: 'POST',
      oidcToken: { serviceAccountEmail: TARGET.serviceAccount } }, retryConfig: { maxRetryDuration: '0s' } });
    await runWorkflow('deploy', f.io);
    expect(f.io.updateJob).not.toHaveBeenCalled();
  });

  it('accepts scheduleTime seconds within the cron minute, including dispatch at 04:00', async () => {
    const f = fixture();
    f.setJob({ ...f.getJob(), scheduleTime: '2026-10-02T04:00:04.483456Z' });
    await runWorkflow('verify', f.io);
    f.io.now = () => Date.parse('2026-10-02T04:00:05Z');
    await runWorkflow('verify', f.io);
  });

  it.each([
    { schedule: '0 5 * * *' }, { timeZone: 'America/Santiago' },
    { scheduleTime: '2026-10-03T04:00:00Z' },
    { scheduleTime: '2026-10-02T04:01:00Z' },
    { httpTarget: { uri: 'https://other.a.run.app', httpMethod: 'POST',
      oidcToken: { serviceAccountEmail: TARGET.serviceAccount } } },
  ])('verify fails clearly for inconsistent jobs (%j)', async patch => {
    const f = fixture(); f.setJob({ ...f.getJob(), ...patch });
    await expect(runWorkflow('verify', f.io)).rejects.toThrow(/Scheduler/);
    expect(f.io.updateJob).not.toHaveBeenCalled();
  });

  it('does not resume a paused job', async () => {
    const f = fixture(); f.setJob({ ...f.getJob(), state: 'PAUSED' });
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('not ENABLED');
    expect(f.io.deployFunction).not.toHaveBeenCalled();
    expect(f.io.updateJob).not.toHaveBeenCalled();
  });

  it('does not recreate a missing function', async () => {
    const f = fixture(); f.io.getFunction.mockResolvedValue(null);
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('Function missing');
    expect(f.io.deployFunction).not.toHaveBeenCalled();
  });

  it('fails without granting IAM if the existing invoker binding is missing', async () => {
    const f = fixture(); f.policy.bindings = [];
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('Missing existing roles/run.invoker');
    expect(f.io.deployFunction).not.toHaveBeenCalled();
    expect(f.io.createJob).not.toHaveBeenCalled();
  });

  it('rejects publicly accessible cleanup and unexpected runtime accounts', async () => {
    const f = fixture(); f.policy.bindings[0].members.push('allUsers');
    await expect(runWorkflow('verify', f.io)).rejects.toThrow('public');
    f.policy.bindings[0].members.pop();
    f.fn.serviceConfig.serviceAccountEmail = 'different@example.test';
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('Runtime account changed');
  });

  it('aborts on function deployment failure before any Scheduler write', async () => {
    const f = fixture(); f.io.deployFunction.mockRejectedValue(new Error('deployment failed'));
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('deployment failed');
    expect(f.io.createJob).not.toHaveBeenCalled(); expect(f.io.updateJob).not.toHaveBeenCalled();
  });

  it('detects a concurrent job configuration change after Function deployment', async () => {
    const f = fixture();
    f.io.deployFunction.mockImplementation(async () => { f.setJob({ ...f.getJob(), schedule: '0 6 * * *' }); });
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('Scheduler changed during deployment');
    expect(f.io.updateJob).not.toHaveBeenCalled();
  });

  it('fails if job update did not actually reconcile the configuration', async () => {
    const f = fixture(); f.setJob({ ...f.getJob(), schedule: '0 6 * * *' });
    f.io.updateJob.mockImplementation(async () => undefined);
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('Scheduler inconsistent');
  });

  it('refuses to replace a target using unexpected authentication', async () => {
    const f = fixture(); f.setJob({ ...f.getJob(), httpTarget: { oauthToken: { serviceAccountEmail: TARGET.serviceAccount } } });
    await expect(runWorkflow('deploy', f.io)).rejects.toThrow('Unexpected Scheduler target');
    expect(f.io.deployFunction).not.toHaveBeenCalled();
  });

  it('calculates the next UTC occurrence across the exact boundary and month end', () => {
    expect(nextExecution(Date.parse('2026-10-01T03:59:59Z'))).toBe('2026-10-01T04:00:00.000Z');
    expect(nextExecution(Date.parse('2026-10-01T04:00:00Z'))).toBe('2026-10-02T04:00:00.000Z');
    expect(nextExecution(Date.parse('2026-10-31T23:00:00Z'))).toBe('2026-11-01T04:00:00.000Z');
    expect(deployArguments('/local/functions')).not.toContain('api');
  });
});
