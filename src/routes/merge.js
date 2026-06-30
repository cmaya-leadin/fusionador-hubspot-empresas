import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProjectById, addLog, saveMergeRun, listMergeRuns, getMergeRunById } from '../db.js';
import { getProjectToken } from './projects.js';
import { requireAuth } from '../middleware/auth.js';
import { canAccessProject } from '../middleware/auth.js';
import { createHubSpotClient } from '../hubspot.js';
import { executeMergeRun } from '../merge-run.js';
import { parseMergeCriteria } from '../merge-criteria.js';
import { createMergeProgress, initSse, writeSse } from '../merge-progress.js';
import {
  executeRetryFailedMerges,
  getFailedMergesSummary,
  loadFailedMergeOperations,
} from '../merge-retry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output');

const router = Router();
router.use(requireAuth);

function parseMergeBody(body) {
  return {
    dryRun: body.dryRun !== false,
    dominio:
      typeof body.dominio === 'string' && body.dominio.trim()
        ? body.dominio.trim()
        : null,
    nombre:
      typeof body.nombre === 'string' && body.nombre.trim()
        ? body.nombre.trim()
        : null,
    recordIds: Array.isArray(body.recordIds)
      ? body.recordIds.map(String).filter(Boolean)
      : [],
    maxGroups:
      body.maxGroups != null && Number.isFinite(Number(body.maxGroups))
        ? Number(body.maxGroups)
        : null,
    confirmFullRun: body.confirmFullRun === true,
    retryFailed: body.retryFailed === true,
    retryRunId:
      body.retryRunId != null && Number.isFinite(Number(body.retryRunId))
        ? Number(body.retryRunId)
        : null,
  };
}

function serializeGroups(groups) {
  return groups.map((group) => ({
    matchKey: group.matchKey,
    matchType: group.matchType,
    matchLabel: group.matchLabel || group.matchType,
    primaryId: group.primaryId,
    primaryName: group.primaryName,
    mergeIds: group.mergeIds,
    records: group.records.map((r) => ({
      id: r.id,
      name: r.name,
      properties: r.properties,
    })),
  }));
}

router.post('/:id/test-connection', async (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!canAccessProject(project, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const token = getProjectToken(project);
  if (!token) {
    return res.status(400).json({ error: 'Token de HubSpot no configurado' });
  }

  try {
    const client = createHubSpotClient(token);
    await client.testConnection();
    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: 'TEST_CONNECTION',
      status: 'SUCCESS',
      message: 'Conexión con HubSpot verificada',
    });
    res.json({ ok: true, message: 'Conexión exitosa' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: 'TEST_CONNECTION',
      status: 'ERROR',
      message,
    });
    res.status(400).json({ error: message });
  }
});

function wantsStream(req) {
  return req.query.stream === '1' || req.body?.stream === true;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {boolean} dryRun
 */
async function handleMerge(req, res, dryRun) {
  const project = getProjectById(Number(req.params.id));
  if (!canAccessProject(project, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const token = getProjectToken(project);
  if (!token) {
    return res.status(400).json({ error: 'Token de HubSpot no configurado' });
  }

  const parsed = parseMergeBody(req.body || {});

  if (parsed.retryFailed && dryRun) {
    return res.status(400).json({ error: 'El reintento de fallos solo aplica a fusión real' });
  }

  const options = {
    ...parsed,
    dryRun,
    entityType: project.entity_type,
    criteria: parseMergeCriteria(
      req.body?.mergeCriteria != null ? req.body.mergeCriteria : project.merge_criteria,
      project.entity_type,
    ),
  };

  const stream = wantsStream(req);
  const startAction = options.retryFailed
    ? 'MERGE_RETRY_START'
    : dryRun
      ? 'SIMULATE_START'
      : 'MERGE_APPLY_START';
  const completeAction = options.retryFailed
    ? 'MERGE_RETRY_COMPLETE'
    : dryRun
      ? 'SIMULATE_COMPLETE'
      : 'MERGE_APPLY_COMPLETE';
  const errorAction = options.retryFailed
    ? 'MERGE_RETRY_ERROR'
    : dryRun
      ? 'SIMULATE_ERROR'
      : 'MERGE_APPLY_ERROR';

  /** @type {ReturnType<typeof createMergeProgress> | null} */
  let progress = null;

  if (stream) {
    initSse(res);
    progress = createMergeProgress((payload) => {
      if (payload.type === 'log') writeSse(res, 'log', payload);
      else if (payload.type === 'progress') writeSse(res, 'progress', payload);
    });
  }

  try {
    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: startAction,
      status: 'INFO',
      message: options.retryFailed
        ? 'Reintentando fusiones fallidas'
        : dryRun
          ? 'Iniciando simulación de fusión'
          : 'Iniciando fusión real en HubSpot',
    });

    const client = createHubSpotClient(token);
    let result;

    if (options.retryFailed) {
      const { operations, sourceLabel } = await loadFailedMergeOperations(
        project.id,
        OUTPUT_DIR,
        options.retryRunId,
      );
      result = await executeRetryFailedMerges(
        client,
        operations,
        project.entity_type,
        progress,
        OUTPUT_DIR,
        sourceLabel,
      );
    } else {
      result = await executeMergeRun(client, options, OUTPUT_DIR, progress);
    }

    const run = saveMergeRun({
      projectId: project.id,
      userId: req.session.userId,
      dryRun,
      stats: result.stats,
      groupsCount: result.groups.length,
      mergesPlanned: result.stats.mergesPlanned,
      results: result.results,
      simulations: result.simulations,
    });

    const completeMessage = options.retryFailed
      ? `Reintento: ${result.stats.mergesApplied} aplicadas, ${result.stats.mergesFailed} fallidas, ${result.stats.mergesSkipped} omitidas`
      : dryRun
        ? `Simulación: ${result.stats.mergeGroups} grupos, ${result.stats.mergesPlanned} fusiones planificadas`
        : `Fusión: ${result.stats.mergesApplied} aplicadas, ${result.stats.mergesFailed} fallidas`;

    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: completeAction,
      status: !dryRun && result.stats.mergesFailed > 0 ? 'WARNING' : 'SUCCESS',
      message: completeMessage,
    });

    const payload = {
      runId: run.id,
      dryRun,
      stats: result.stats,
      groups: serializeGroups(result.groups),
      simulations: result.simulations,
      results: result.results,
      csvPath: result.csvPath,
      resultsCsvPath: result.resultsCsvPath,
    };

    if (stream) {
      writeSse(res, 'complete', payload);
      res.end();
      return;
    }

    if (dryRun) {
      res.json(payload);
    } else {
      res.json({
        runId: run.id,
        dryRun: false,
        stats: result.stats,
        groups: serializeGroups(result.groups),
        results: result.results,
        csvPath: result.csvPath,
        resultsCsvPath: result.resultsCsvPath,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress?.fail(message);
    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: errorAction,
      status: 'ERROR',
      message,
    });

    if (stream) {
      writeSse(res, 'error', { message });
      res.end();
      return;
    }

    res.status(500).json({ error: message });
  }
}

router.post('/:id/simulate', (req, res) => handleMerge(req, res, true));

router.post('/:id/apply', (req, res) => handleMerge(req, res, false));

router.get('/:id/failed-merges', async (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!canAccessProject(project, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const summary = await getFailedMergesSummary(project.id, OUTPUT_DIR);
  res.json(summary);
});

router.post('/:id/retry-failed', (req, res) => {
  req.body = { ...(req.body || {}), retryFailed: true, dryRun: false, stream: req.body?.stream };
  return handleMerge(req, res, false);
});

router.get('/:id/runs', (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!canAccessProject(project, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const runs = listMergeRuns(project.id, Number(req.query.limit) || 20);
  res.json({
    runs: runs.map((run) => ({
      id: run.id,
      dryRun: Boolean(run.dry_run),
      stats: JSON.parse(run.stats || '{}'),
      groupsCount: run.groups_count,
      mergesPlanned: run.merges_planned,
      username: run.username,
      createdAt: run.created_at,
    })),
  });
});

router.get('/:id/runs/:runId', (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!canAccessProject(project, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const run = getMergeRunById(Number(req.params.runId));
  if (!run || run.project_id !== project.id) {
    return res.status(404).json({ error: 'Ejecución no encontrada' });
  }

  res.json({
    run: {
      id: run.id,
      dryRun: Boolean(run.dry_run),
      stats: JSON.parse(run.stats || '{}'),
      groupsCount: run.groups_count,
      mergesPlanned: run.merges_planned,
      results: JSON.parse(run.results || '[]'),
      simulations: JSON.parse(run.simulations || '[]'),
      createdAt: run.created_at,
    },
  });
});

export default router;
