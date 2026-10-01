import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const TARGET = Object.freeze({
  project: 'nova-star-bd0d9', function: 'cleanupTvPairingsDaily',
  functionRegion: 'southamerica-west1', schedulerLocation: 'southamerica-east1',
  jobId: 'firebase-schedule-cleanupTvPairingsDaily-southamerica-west1',
  schedule: '0 4 * * *', timeZone: 'UTC',
  serviceAccount: '870971438774-compute@developer.gserviceaccount.com',
});
const functionName = `projects/${TARGET.project}/locations/${TARGET.functionRegion}/functions/${TARGET.function}`;
const jobName = `projects/${TARGET.project}/locations/${TARGET.schedulerLocation}/jobs/${TARGET.jobId}`;
const functionDir = fileURLToPath(new URL('.', import.meta.url));
const normalizeUri = (uri) => typeof uri === 'string' ? uri.replace(/\/$/, '') : '';
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function deployArguments(source, buildServiceAccount) {
  return [
    'functions', 'deploy', TARGET.function, '--gen2', '--trigger-http',
    `--entry-point=${TARGET.function}`, '--runtime=nodejs22',
    `--region=${TARGET.functionRegion}`, `--project=${TARGET.project}`, `--source=${source}`,
    '--ignore-file=.gcloudignore', '--memory=256Mi', '--timeout=300s',
    '--min-instances=0', '--max-instances=1', '--concurrency=1',
    `--service-account=${TARGET.serviceAccount}`, '--serve-all-traffic-latest-revision',
    // Match Firebase CLI's compiled-TypeScript build configuration.
    '--update-build-env-vars=GOOGLE_NODE_RUN_SCRIPTS=',
    ...(buildServiceAccount ? [`--build-service-account=${buildServiceAccount}`] : []),
    '--quiet', '--format=json',
  ];
}

export function validateFunction(fn) {
  check(fn?.name === functionName, 'Function missing or unexpected project/name/region. No resources will be recreated.');
  check(fn.state === 'ACTIVE', `Function is not ACTIVE (${fn.state || 'unknown'}).`);
  check(fn.environment === 'GEN_2' && !fn.eventTrigger, 'Expected an existing Gen 2 HTTP function.');
  check(fn.buildConfig?.runtime === 'nodejs22' && fn.buildConfig?.entryPoint === TARGET.function,
    'Function runtime or entry point differs from the approved configuration.');
  const c = fn.serviceConfig;
  check(c?.serviceAccountEmail === TARGET.serviceAccount, 'Runtime account changed; stop without changing service accounts or IAM.');
  check(c.timeoutSeconds === 300 && c.availableMemory === '256Mi' && c.maxInstanceCount === 1 &&
    (c.minInstanceCount || 0) === 0 && c.maxInstanceRequestConcurrency === 1,
  'Function resource configuration differs from the approved values.');
  check(c.service === `projects/${TARGET.project}/locations/${TARGET.functionRegion}/services/cleanuptvpairingsdaily`,
    'Unexpected Cloud Run service; refusing to target a different function.');
  check(/^https:\/\/[^/]+\.a\.run\.app\/?$/.test(c.uri), 'Missing or invalid Function HTTP URI.');
  return fn;
}

export function validateInvoker(policy) {
  const bindings = policy.bindings || [];
  const invokers = bindings.filter(b => b.role === 'roles/run.invoker').flatMap(b => b.members || []);
  check(!invokers.includes('allUsers') && !invokers.includes('allAuthenticatedUsers'),
    'Cleanup invocation is public; stop for IAM review. This script never modifies IAM.');
  check(bindings.some(b => b.role === 'roles/run.invoker' && !b.condition &&
    (b.members || []).includes(`serviceAccount:${TARGET.serviceAccount}`)),
    'Missing existing roles/run.invoker binding for the Scheduler account; request explicit IAM review.');
}

export function desiredJob(fn) {
  return {
    name: jobName, schedule: TARGET.schedule, timeZone: TARGET.timeZone,
    httpTarget: { uri: fn.serviceConfig.uri, httpMethod: 'POST',
      oidcToken: { serviceAccountEmail: TARGET.serviceAccount } },
    attemptDeadline: '300s', retryConfig: { retryCount: 0, maxRetryDuration: '0s' },
  };
}

export function jobDrift(job, expected) {
  const differences = [];
  for (const key of ['name', 'schedule', 'timeZone', 'attemptDeadline']) {
    if (job[key] !== expected[key]) differences.push(key);
  }
  if (normalizeUri(job.httpTarget?.uri) !== normalizeUri(expected.httpTarget.uri)) differences.push('httpTarget.uri');
  if (job.httpTarget?.httpMethod !== 'POST') differences.push('httpTarget.httpMethod');
  if (job.httpTarget?.oidcToken?.serviceAccountEmail !== TARGET.serviceAccount) differences.push('httpTarget.oidcToken.serviceAccountEmail');
  if (job.httpTarget?.oidcToken?.audience && normalizeUri(job.httpTarget.oidcToken.audience) !== normalizeUri(expected.httpTarget.uri)) {
    differences.push('httpTarget.oidcToken.audience');
  }
  if ((job.retryConfig?.retryCount || 0) !== 0) differences.push('retryConfig.retryCount');
  if ((job.retryConfig?.maxRetryDuration || '0s') !== '0s') differences.push('retryConfig.maxRetryDuration');
  if (job.pubsubTarget || job.appEngineHttpTarget || job.httpTarget?.oauthToken) differences.push('unsupported target/authentication');
  return differences;
}

export function nextExecution(now) {
  const next = new Date(now); next.setUTCHours(4, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export function verifyJob(job, fn, now) {
  check(job, 'Scheduler job missing in southamerica-east1.');
  const differences = jobDrift(job, desiredJob(fn));
  check(differences.length === 0, `Scheduler inconsistent: ${differences.join(', ')}.`);
  check(job.state === 'ENABLED', `Scheduler is ${job.state || 'unknown'}; it will not be resumed automatically.`);
  // Google's scheduleTime can include seconds/fractions within the cron minute.
  // At 04:00 itself, allow the current occurrence while it is being dispatched.
  const minuteStart = now - (now % 60_000);
  const expected = Date.parse(nextExecution(minuteStart - 1));
  const scheduled = Date.parse(job.scheduleTime);
  check(scheduled >= expected && scheduled < expected + 60_000,
    'Scheduler next execution is missing or inconsistent with 04:00 UTC daily.');
  return {
    function: fn.name, functionUri: fn.serviceConfig.uri, functionRegion: TARGET.functionRegion,
    job: job.name, schedulerLocation: TARGET.schedulerLocation, schedule: job.schedule,
    timeZone: job.timeZone, state: job.state, nextExecution: job.scheduleTime,
  };
}

// IO is injected so tests cannot contact Google Cloud or invoke deployments.
export async function runWorkflow(mode, io) {
  check(['deploy', 'verify', 'dry-run'].includes(mode), 'Choose --deploy, --verify or --dry-run.');
  if (mode === 'dry-run') return {
    mode, ...TARGET, mutations: false, cloudReads: false,
    localValidation: ['npm ci', 'npm run lint', 'npm test', 'npm run build'],
    functionDeploy: ['gcloud', ...deployArguments(functionDir)],
    scheduler: { resource: jobName, action: 'GET then CREATE if absent or PATCH only approved drift; VERIFY afterward' },
    iam: 'GET only; never grant/remove bindings', invokesCleanup: false,
  };
  if (mode === 'deploy') await io.validateLocal();
  const before = validateFunction(await io.getFunction());
  const policy = await io.getInvoker(before); validateInvoker(policy);
  const locations = await io.getLocations();
  check(locations.includes(TARGET.schedulerLocation), 'Scheduler location southamerica-east1 is unavailable.');
  let job = await io.getJob();
  if (job) {
    check(job.name === jobName, 'Unexpected Scheduler job name.');
    check(job.state === 'ENABLED', 'Job is not ENABLED; stop without resuming it.');
    check(!job.pubsubTarget && !job.appEngineHttpTarget && !job.httpTarget?.oauthToken,
      'Unexpected Scheduler target/authentication; stop without replacing it.');
  }
  let fn = before; let schedulerAction = 'unchanged';
  if (mode === 'deploy') {
    await io.deployFunction(deployArguments(functionDir, before.buildConfig.serviceAccount));
    fn = validateFunction(await io.getFunction());
    const afterPolicy = await io.getInvoker(fn); validateInvoker(afterPolicy);
    check(JSON.stringify(sortedBindings(policy)) === JSON.stringify(sortedBindings(afterPolicy)),
      'Invoker policy changed during deployment; stop for review.');
    const desired = desiredJob(fn);
    // Reread after deploy; a concurrent pause/change must not be overwritten.
    const latest = await io.getJob();
    check(JSON.stringify(jobConfiguration(latest)) === JSON.stringify(jobConfiguration(job)),
      'Scheduler changed during deployment; stop before updating it.');
    if (!job) {
      await io.createJob(desired); schedulerAction = 'created';
    } else {
      const differences = jobDrift(job, desired);
      if (differences.length) {
        check(!differences.includes('name') && !differences.includes('unsupported target/authentication'),
          'Scheduler cannot be reconciled safely.');
        const patch = { ...desired, httpTarget: { ...desired.httpTarget,
          oidcToken: { ...desired.httpTarget.oidcToken,
            ...(differences.includes('httpTarget.oidcToken.audience') ? { audience: fn.serviceConfig.uri } : {}) } } };
        await io.updateJob(patch, differences); schedulerAction = 'updated';
      }
    }
    job = await io.getJob();
  }
  return { mode, schedulerAction, ...verifyJob(job, fn, io.now()), iamModified: false, invokesCleanup: false };
}

function sortedBindings(policy) {
  return (policy.bindings || []).map(b => ({ ...b, members: [...(b.members || [])].sort() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function jobConfiguration(job) {
  if (!job) return null;
  // Operational timestamps/status may change normally without a config edit.
  return { name: job.name, state: job.state, schedule: job.schedule, timeZone: job.timeZone,
    httpTarget: job.httpTarget, pubsubTarget: job.pubsubTarget, appEngineHttpTarget: job.appEngineHttpTarget,
    attemptDeadline: job.attemptDeadline, retryConfig: job.retryConfig };
}

function command(binary, args) {
  const options = { cwd: functionDir, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
  let result;
  if (process.platform === 'win32' && (binary === 'gcloud' || binary === 'npm')) {
    const literal = value => `'${value.replace(/'/g, "''")}'`;
    result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `& ${binary} ${args.map(literal).join(' ')}; exit $LASTEXITCODE`], options);
  } else result = spawnSync(binary, args, options);
  // Never echo captured stdout/stderr (auth tokens or provider detail).
  check(!result.error && result.status === 0, `${binary} ${args.slice(0, 2).join(' ')} failed; no subsequent deployment steps were run. Run that command separately for diagnostics.`);
  return result.stdout.trim();
}

function cloudIO() {
  let token;
  async function api(url, method = 'GET', body, allowMissing = false) {
    token ||= command('gcloud', ['auth', 'print-access-token']);
    const response = await fetch(url, { method, headers: {
      Authorization: `Bearer ${token}`, 'x-goog-user-project': TARGET.project,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
    if (allowMissing && response.status === 404) return null;
    check(response.ok, `${method} ${new URL(url).pathname} failed (HTTP ${response.status}). No IAM changes or resource deletion attempted.`);
    return response.json();
  }
  const functionUrl = `https://cloudfunctions.googleapis.com/v2/${functionName}`;
  const jobUrl = `https://cloudscheduler.googleapis.com/v1/${jobName}`;
  return {
    now: Date.now,
    validateLocal: async () => {
      check(Number(process.versions.node.split('.')[0]) === 22, 'Deploy requires Node 22.');
      const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
      check(pkg.name === 'nexo-functions' && pkg.engines.node === '22' && pkg.main === 'lib/index.js', 'Unexpected package/runtime configuration.');
      for (const args of [['ci'], ['run', 'lint'], ['test'], ['run', 'build']]) {
        console.log(`Local validation: npm ${args.join(' ')}`); command('npm', args);
      }
      const manifest = createRequire(import.meta.url)('./lib/index.js').cleanupTvPairingsDaily.__endpoint;
      check(manifest?.scheduleTrigger?.schedule === TARGET.schedule && manifest.scheduleTrigger.timeZone === TARGET.timeZone,
        'Compiled onSchedule manifest differs from the approved schedule/timezone.');
      // Confirm actual upload contents against the allowlist before publishing.
      const files = command('gcloud', ['meta', 'list-files-for-upload']).split(/\r?\n/).map(p => p.replaceAll('\\', '/'));
      check(files.includes('package.json') && files.includes('package-lock.json') && files.includes('lib/index.js'), 'Runtime files missing from gcloud upload.');
      check(files.every(p => p === 'package.json' || p === 'package-lock.json' || /^lib\/.*\.(js|js\.map)$/.test(p)), 'Unexpected file in upload; refuse to package env, secrets, tests or source tooling.');
    },
    getFunction: () => api(`${functionUrl}?fields=name,state,environment,eventTrigger,buildConfig(runtime,entryPoint,serviceAccount),serviceConfig(service,uri,serviceAccountEmail,timeoutSeconds,availableMemory,minInstanceCount,maxInstanceCount,maxInstanceRequestConcurrency)`, 'GET', undefined, true),
    getInvoker: fn => api(`https://run.googleapis.com/v2/${fn.serviceConfig.service}:getIamPolicy`),
    getLocations: async () => {
      const locations = []; let page;
      do { const url = new URL(`https://cloudscheduler.googleapis.com/v1/projects/${TARGET.project}/locations`);
        if (page) url.searchParams.set('pageToken', page);
        const result = await api(url); locations.push(...(result.locations || []).map(l => l.locationId)); page = result.nextPageToken;
      } while (page);
      return locations;
    },
    getJob: () => api(`${jobUrl}?fields=name,state,schedule,timeZone,scheduleTime,httpTarget(uri,httpMethod,oidcToken,oauthToken),pubsubTarget,appEngineHttpTarget,attemptDeadline,retryConfig`, 'GET', undefined, true),
    deployFunction: async args => { console.log(`Deploying only ${TARGET.function} in ${TARGET.functionRegion}.`); command('gcloud', args); },
    createJob: job => api(`https://cloudscheduler.googleapis.com/v1/projects/${TARGET.project}/locations/${TARGET.schedulerLocation}/jobs`, 'POST', job),
    updateJob: (job, mask) => api(`${jobUrl}?updateMask=${encodeURIComponent(mask.join(','))}`, 'PATCH', job),
  };
}

export function parseMode(args) {
  check(args.length <= 1 && args.every(a => ['--deploy', '--verify', '--dry-run'].includes(a)), 'Usage: node deploy-cleanup.mjs [--verify|--dry-run|--deploy]');
  return (args[0] || '--verify').slice(2);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const mode = parseMode(process.argv.slice(2));
    console.log(JSON.stringify(await runWorkflow(mode, mode === 'dry-run' ? {} : cloudIO()), null, 2));
  } catch (error) {
    console.error(`Cleanup deployment verification failed: ${error.message}`); process.exitCode = 1;
  }
}
