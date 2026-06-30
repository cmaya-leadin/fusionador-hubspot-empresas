import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readCsv } from './csv.js';
import { getLastApplyRun, getMergeRunById } from './db.js';
import { executeMergeOperations, MERGE_RESULTS_CSV_HEADERS, resultsToCsvRows } from './merge.js';
import { writeCsv } from './csv.js';

/**
 * @typedef {Object} FailedMergeOperation
 * @property {string} primaryId
 * @property {string} mergeId
 * @property {string} [groupKey]
 * @property {string} [matchType]
 */

/**
 * @param {Record<string, string>} row
 * @returns {FailedMergeOperation | null}
 */
function rowToOperation(row) {
  const status = (row.status || '').toLowerCase();
  if (status !== 'failed') return null;

  const primaryId = row.primary_id || row.primaryId || '';
  const mergeId = row.merge_id || row.mergeId || '';
  if (!primaryId || !mergeId) return null;

  return {
    primaryId: String(primaryId),
    mergeId: String(mergeId),
    groupKey: row.group_key || row.groupKey || '',
    matchType: row.match_type || row.matchType || '',
  };
}

/**
 * @param {FailedMergeOperation[]} operations
 */
function dedupeOperations(operations) {
  const seen = new Set();
  const out = [];
  for (const op of operations) {
    const key = `${op.primaryId}|${op.mergeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(op);
  }
  return out;
}

/**
 * @param {unknown[]} results
 * @returns {FailedMergeOperation[]}
 */
export function failedOperationsFromResults(results) {
  const ops = [];
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (raw);
    if (r.status !== 'failed') continue;
    const primaryId = String(r.primaryId || '');
    const mergeId = String(r.mergeId || '');
    if (!primaryId || !mergeId) continue;
    ops.push({
      primaryId,
      mergeId,
      groupKey: r.groupKey ? String(r.groupKey) : '',
      matchType: r.matchType ? String(r.matchType) : '',
    });
  }
  return dedupeOperations(ops);
}

/**
 * @param {string} outputDir
 * @returns {Promise<FailedMergeOperation[]>}
 */
async function loadFailedFromLatestCsv(outputDir) {
  let files;
  try {
    files = await readdir(outputDir);
  } catch {
    return [];
  }

  const candidates = files.filter((f) => f.startsWith('fusiones_resultados') && f.endsWith('.csv'));
  if (!candidates.length) return [];

  const withStat = await Promise.all(
    candidates.map(async (name) => {
      const full = path.join(outputDir, name);
      const s = await stat(full);
      return { name, full, mtime: s.mtimeMs };
    }),
  );
  withStat.sort((a, b) => b.mtime - a.mtime);

  const rows = await readCsv(withStat[0].full);
  const ops = rows.map(rowToOperation).filter(Boolean);
  return dedupeOperations(/** @type {FailedMergeOperation[]} */ (ops));
}

/**
 * @param {number} projectId
 * @param {string} outputDir
 * @param {number | null} [retryRunId]
 */
export async function loadFailedMergeOperations(projectId, outputDir, retryRunId = null) {
  if (retryRunId) {
    const run = getMergeRunById(retryRunId);
    if (!run || run.project_id !== projectId || run.dry_run) {
      throw new Error('Ejecución no encontrada o no es una fusión real');
    }
    const results = JSON.parse(run.results || '[]');
    const ops = failedOperationsFromResults(results);
    if (!ops.length) {
      throw new Error('La ejecución seleccionada no tiene fusiones fallidas');
    }
    return {
      operations: ops,
      source: 'run',
      sourceRunId: run.id,
      sourceLabel: `ejecución #${run.id}`,
    };
  }

  const lastRun = getLastApplyRun(projectId);
  if (lastRun) {
    const results = JSON.parse(lastRun.results || '[]');
    const ops = failedOperationsFromResults(results);
    if (ops.length) {
      return {
        operations: ops,
        source: 'run',
        sourceRunId: lastRun.id,
        sourceLabel: `última ejecución #${lastRun.id}`,
      };
    }
  }

  const csvOps = await loadFailedFromLatestCsv(outputDir);
  if (csvOps.length) {
    return {
      operations: csvOps,
      source: 'csv',
      sourceRunId: lastRun?.id ?? null,
      sourceLabel: 'último CSV de resultados en output/',
    };
  }

  throw new Error(
    'No hay fusiones fallidas para reintentar. Ejecuta una fusión real primero o revisa output/fusiones_resultados_*.csv',
  );
}

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {FailedMergeOperation[]} operations
 * @param {'companies' | 'contacts'} entityType
 * @param {ReturnType<import('./merge-progress.js').createMergeProgress> | null} [progress]
 * @param {string} outputDir
 * @param {string} sourceLabel
 */
export async function executeRetryFailedMerges(
  client,
  operations,
  entityType,
  progress,
  outputDir,
  sourceLabel,
) {
  const total = operations.length;
  progress?.start(entityType, false);
  progress?.log(`Reintentando ${total} fusiones fallidas (${sourceLabel})…`);

  const { results, stats: mergeStats } = await executeMergeOperations(
    client,
    entityType,
    operations,
    {
      onLog: (msg) => progress?.log(msg),
      onStep: (data) => progress?.mergeStep(data),
    },
  );

  const mergesApplied = mergeStats.mergesApplied;
  const mergesFailed = mergeStats.mergesFailed;
  const mergesSkipped = mergeStats.mergesSkipped;

  for (const row of results) {
    row.retried = true;
  }

  const stats = {
    totalRecords: 0,
    eligibleRecords: 0,
    skippedInactive: 0,
    skippedOnlyProveedor: 0,
    skippedNoName: 0,
    mergeGroups: 0,
    mergesPlanned: total,
    mergesApplied,
    mergesSkipped,
    mergesFailed,
    retryMode: true,
    retrySource: sourceLabel,
  };

  progress?.done(stats, false);

  const resultsCsvPath = path.join(outputDir, `fusiones_reintento_${Date.now()}.csv`);
  await writeCsv(resultsCsvPath, MERGE_RESULTS_CSV_HEADERS, resultsToCsvRows(results));

  return {
    dryRun: false,
    stats,
    groups: [],
    results,
    simulations: [],
    resultsCsvPath,
    retryMode: true,
  };
}

/**
 * @param {number} projectId
 * @param {string} outputDir
 */
export async function getFailedMergesSummary(projectId, outputDir) {
  try {
    const { operations, source, sourceRunId, sourceLabel } = await loadFailedMergeOperations(
      projectId,
      outputDir,
    );
    return {
      count: operations.length,
      source,
      sourceRunId,
      sourceLabel,
    };
  } catch {
    return { count: 0, source: null, sourceRunId: null, sourceLabel: null };
  }
}
