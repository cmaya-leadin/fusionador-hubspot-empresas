/** @typedef {'running' | 'completed' | 'error'} MergeJobStatus */
/** @typedef {'simulate' | 'apply' | 'retry'} MergeJobMode */

const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_EVENTS = 1000;

/** @type {Map<number, object>} */
const jobsByProject = new Map();

/**
 * @param {number} projectId
 * @param {{ mode: MergeJobMode, dryRun: boolean }} meta
 */
export function startJob(projectId, meta) {
  const job = {
    projectId,
    jobId: `${projectId}-${Date.now()}`,
    status: /** @type {MergeJobStatus} */ ('running'),
    mode: meta.mode,
    dryRun: meta.dryRun,
    startedAt: Date.now(),
    finishedAt: null,
    progress: null,
    logs: [],
    events: [],
    result: null,
    error: null,
    subscribers: new Set(),
  };
  jobsByProject.set(projectId, job);
  return job;
}

/**
 * @param {number} projectId
 */
function getJob(projectId) {
  const job = jobsByProject.get(projectId);
  if (!job) return null;
  if (job.status !== 'running' && job.finishedAt && Date.now() - job.finishedAt > JOB_TTL_MS) {
    jobsByProject.delete(projectId);
    return null;
  }
  return job;
}

/**
 * @param {object} job
 * @param {string} event
 * @param {unknown} data
 */
function appendEvent(job, event, data) {
  job.events.push({ event, data });
  if (job.events.length > MAX_EVENTS) {
    job.events.shift();
  }
  for (const subscriber of job.subscribers) {
    try {
      subscriber(event, data);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {number} projectId
 * @param {Record<string, unknown>} data
 */
export function recordProgress(projectId, data) {
  const job = jobsByProject.get(projectId);
  if (!job || job.status !== 'running') return;
  job.progress = data;
  appendEvent(job, 'progress', data);
}

/**
 * @param {number} projectId
 * @param {Record<string, unknown>} data
 */
export function recordLog(projectId, data) {
  const job = jobsByProject.get(projectId);
  if (!job) return;
  job.logs.push(data);
  if (job.logs.length > 500) job.logs.shift();
  appendEvent(job, 'log', data);
}

/**
 * @param {number} projectId
 * @param {unknown} result
 */
export function completeJob(projectId, result) {
  const job = jobsByProject.get(projectId);
  if (!job) return;
  job.status = 'completed';
  job.finishedAt = Date.now();
  job.result = result;
  appendEvent(job, 'complete', result);
}

/**
 * @param {number} projectId
 * @param {string} message
 */
export function failJob(projectId, message) {
  const job = jobsByProject.get(projectId);
  if (!job) return;
  job.status = 'error';
  job.finishedAt = Date.now();
  job.error = message;
  appendEvent(job, 'error', { message });
}

/**
 * @param {number} projectId
 * @param {(event: string, data: unknown) => void} callback
 */
export function subscribeJob(projectId, callback) {
  const job = jobsByProject.get(projectId);
  if (!job) return () => {};
  job.subscribers.add(callback);
  return () => job.subscribers.delete(callback);
}

/**
 * @param {number} projectId
 */
export function getJobSnapshot(projectId) {
  const job = getJob(projectId);
  if (!job) {
    return { active: false, recent: false, job: null };
  }

  return {
    active: job.status === 'running',
    recent: job.status !== 'running',
    job: {
      status: job.status,
      mode: job.mode,
      dryRun: job.dryRun,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progress: job.progress,
      logs: job.logs,
      result: job.result,
      error: job.error,
      eventCount: job.events.length,
    },
  };
}

/**
 * @param {number} projectId
 */
export function getJobForStream(projectId) {
  return getJob(projectId);
}
