/**
 * @typedef {'init' | 'fetch' | 'analyze' | 'simulate' | 'merge' | 'export' | 'done' | 'error'} MergePhase
 *
 * @typedef {Object} ProgressSnapshot
 * @property {MergePhase} phase
 * @property {string} message
 * @property {number} percent
 * @property {number | null} [etaSeconds]
 * @property {Record<string, number | string | null>} [stats]
 */

/**
 * @param {number} percent
 * @param {number} startedAt
 */
function estimateEtaSeconds(percent, startedAt) {
  if (percent <= 0 || percent >= 100) return null;
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed < 1) return null;
  const total = elapsed / (percent / 100);
  return Math.max(0, Math.round(total - elapsed));
}

/**
 * @param {(payload: Record<string, unknown>) => void} emit
 */
export function createMergeProgress(emit) {
  const startedAt = Date.now();
  /** @type {MergePhase} */
  let phase = 'init';
  /** @type {Record<string, number | string | null>} */
  let stats = {};

  /**
   * @param {Partial<ProgressSnapshot>} patch
   */
  function push(patch) {
    if (patch.phase) phase = patch.phase;
    if (patch.stats) stats = { ...stats, ...patch.stats };

    const percent = Math.min(100, Math.max(0, patch.percent ?? 0));
    emit({
      type: 'progress',
      phase,
      message: patch.message || '',
      percent,
      etaSeconds: estimateEtaSeconds(percent, startedAt),
      stats: { ...stats },
    });
  }

  return {
    /**
     * @param {string} message
     * @param {'info' | 'success' | 'warning' | 'error'} [level]
     */
    log(message, level = 'info') {
      emit({ type: 'log', message, level, ts: Date.now() });
    },

    start(entityType, dryRun) {
      const label = entityType === 'contacts' ? 'contactos' : 'empresas';
      push({
        phase: 'init',
        message: dryRun ? `Iniciando simulación (${label})…` : `Iniciando fusión real (${label})…`,
        percent: 1,
        stats: { entityType, dryRun: dryRun ? 1 : 0 },
      });
    },

    /**
     * @param {number} fetched
     * @param {number | null} [estimatedTotal]
     */
    fetchPage(fetched, estimatedTotal = null) {
      let percent = 8;
      if (estimatedTotal && estimatedTotal > 0) {
        percent = 5 + Math.round((fetched / estimatedTotal) * 40);
      } else {
        percent = Math.min(42, 8 + Math.floor(fetched / 150));
      }
      push({
        phase: 'fetch',
        message: `${fetched.toLocaleString('es-ES')} ${stats.entityType === 'contacts' ? 'contactos' : 'empresas'} leídos de HubSpot…`,
        percent,
        stats: { recordsRead: fetched, estimatedTotal },
      });
    },

    /**
     * @param {number} total
     */
    fetchDone(total) {
      push({
        phase: 'fetch',
        message: `Lectura completada: ${total.toLocaleString('es-ES')} registros`,
        percent: 45,
        stats: { recordsRead: total, totalRecords: total },
      });
    },

    /**
     * @param {import('./merge.js').MergeStats} mergeStats
     */
    analyzeDone(mergeStats) {
      push({
        phase: 'analyze',
        message: `${mergeStats.mergeGroups} grupos detectados · ${mergeStats.mergesPlanned} fusiones planificadas`,
        percent: 58,
        stats: {
          mergeGroups: mergeStats.mergeGroups,
          mergesPlanned: mergeStats.mergesPlanned,
          eligibleRecords: mergeStats.eligibleRecords,
          totalRecords: mergeStats.totalRecords,
          recordsWithNameAndPhone: mergeStats.recordsWithNameAndPhone ?? null,
        },
      });
    },

    simulateDone() {
      push({
        phase: 'simulate',
        message: 'Simulación de objetos fusionados completada',
        percent: 62,
      });
    },

    /**
     * @param {Object} params
     */
    mergeStep({ current, total, primaryId, mergeId, status, error }) {
      const base = 62;
      const span = 35;
      const percent = total > 0 ? base + Math.round((current / total) * span) : base;
      let message = `Fusionando ${current}/${total}: ${mergeId} → ${primaryId}`;
      if (status === 'merged') message = `✓ Fusionado ${mergeId} en ${primaryId} (${current}/${total})`;
      else if (status === 'skipped') message = `○ Omitido ${mergeId} (${current}/${total})`;
      else if (status === 'failed') message = `✗ Error ${mergeId}: ${error || 'desconocido'}`;

      push({
        phase: 'merge',
        message,
        percent,
        stats: {
          currentMerge: current,
          totalMerges: total,
          lastMergeId: mergeId,
          lastPrimaryId: primaryId,
          lastStatus: status,
        },
      });
    },

    exportDone() {
      push({
        phase: 'export',
        message: 'Exportando resultados a CSV…',
        percent: 98,
      });
    },

    /**
     * @param {import('./merge.js').MergeStats} finalStats
     * @param {boolean} dryRun
     */
    done(finalStats, dryRun) {
      const message = dryRun
        ? `Simulación finalizada: ${finalStats.mergeGroups} grupos, ${finalStats.mergesPlanned} fusiones planificadas`
        : `Fusión finalizada: ${finalStats.mergesApplied} aplicadas, ${finalStats.mergesFailed} fallidas, ${finalStats.mergesSkipped || 0} omitidas`;

      push({
        phase: 'done',
        message,
        percent: 100,
        etaSeconds: 0,
        stats: {
          mergeGroups: finalStats.mergeGroups,
          mergesPlanned: finalStats.mergesPlanned,
          mergesApplied: finalStats.mergesApplied,
          mergesFailed: finalStats.mergesFailed,
          mergesSkipped: finalStats.mergesSkipped || 0,
          totalRecords: finalStats.totalRecords,
          eligibleRecords: finalStats.eligibleRecords,
        },
      });
    },

    fail(message) {
      push({ phase: 'error', message, percent: 100, etaSeconds: 0 });
      emit({ type: 'log', message, level: 'error', ts: Date.now() });
    },
  };
}

/**
 * @param {import('express').Response} res
 * @param {string} event
 * @param {unknown} data
 */
export function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * @param {import('express').Response} res
 */
export function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}
